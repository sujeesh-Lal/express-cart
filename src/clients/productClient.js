/**
 * productClient — HTTP client for the Product Service.
 *
 * Used when PRODUCT_SERVICE_URL is set (microservice mode).
 * Falls back transparently to productRepository when it is not set (monolith mode).
 *
 * Every outbound call is wrapped with:
 *   - Circuit breaker  (trips after 3 failures in 30 s)
 *   - Retry            (up to 3 attempts, exponential back-off, 5xx only)
 *   - Service JWT      (Authorization: Bearer <SERVICE_TOKEN>)
 */

const axios = require('axios');
const { services } = require('../config/env');
const { CircuitBreaker, CircuitOpenError } = require('../utils/circuitBreaker');
const { withRetry } = require('../utils/retry');

// ── HTTP instance ─────────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: services.productServiceUrl,
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
    ...(services.serviceToken && {
      Authorization: `Bearer ${services.serviceToken}`,
    }),
  },
});

// ── Circuit breaker ───────────────────────────────────────────────────────────

const cb = new CircuitBreaker('product-service-http', {
  failureThreshold:  3,
  windowMs:          30_000,
  recoveryTimeoutMs: 60_000,
});

// ── Shared executor — circuit breaker + retry ─────────────────────────────────

async function call(fn) {
  return cb.exec(() =>
    withRetry(fn, { retries: 3, delayMs: 300 })
  );
}

// ── Error normaliser ─────────────────────────────────────────────────────────

function normaliseError(err) {
  if (err instanceof CircuitOpenError) return err;
  if (err.response) {
    // Axios HTTP error — forward status + message from downstream
    const status  = err.response.status;
    const message = err.response.data?.error || err.response.data?.message || err.message;
    return Object.assign(new Error(message), { status });
  }
  // Network / timeout
  return Object.assign(new Error(`Product service unreachable: ${err.message}`), { status: 503 });
}

// ── Client methods ────────────────────────────────────────────────────────────

const productClient = {
  /**
   * Fetch a single product by ID.
   * Throws 404-shaped error if not found.
   */
  async getProduct(id) {
    try {
      const { data } = await call(() => http.get(`/products/${id}`));
      return data;
    } catch (err) {
      throw normaliseError(err);
    }
  },

  /**
   * Fetch a paginated list of products.
   * @param {object} query — same query params as GET /products
   */
  async listProducts(query = {}) {
    try {
      const { data } = await call(() => http.get('/products', { params: query }));
      return data;
    } catch (err) {
      throw normaliseError(err);
    }
  },

  /**
   * Atomically decrement stock for one product.
   * Called by Order Service after checkout validation.
   *
   * POST /products/:id/decrement-stock  { quantity }
   */
  async decrementStock(productId, quantity) {
    try {
      const { data } = await call(() =>
        http.post(`/products/${productId}/decrement-stock`, { quantity })
      );
      return data;
    } catch (err) {
      throw normaliseError(err);
    }
  },

  /**
   * Restore stock for one product (compensating call on order failure/cancel).
   *
   * POST /products/:id/release-stock  { quantity }
   */
  async releaseStock(productId, quantity) {
    try {
      const { data } = await call(() =>
        http.post(`/products/${productId}/release-stock`, { quantity })
      );
      return data;
    } catch (err) {
      throw normaliseError(err);
    }
  },

  /** Expose circuit breaker status for health-check endpoints. */
  getCircuitStatus() {
    return cb.getStatus();
  },
};

module.exports = productClient;
