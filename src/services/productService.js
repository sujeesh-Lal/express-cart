const productRepository = require('../repositories/productRepository');
const mockProductService = require('./mockProductService');
const { CircuitBreaker, CircuitOpenError } = require('../utils/circuitBreaker');

// Circuit breaker for the product listing DB call.
// Trips after 3 failures within a 30-second window; stays open for 60 seconds.
const productListCircuitBreaker = new CircuitBreaker('product-list', {
  failureThreshold: 3,
  windowMs: 30_000,       // 30 seconds
  recoveryTimeoutMs: 60_000,
});

const productService = {
  async listProducts(query) {
    try {
      return await productListCircuitBreaker.exec(() =>
        productRepository.findAll(query)
      );
    } catch (err) {
      // Circuit is OPEN (or just tripped) — fall back to mock data
      if (err instanceof CircuitOpenError || productListCircuitBreaker.getStatus().state !== 'CLOSED') {
        console.warn('[productService] Falling back to mock data —', err.message);
        return mockProductService.listProducts(query);
      }
      throw err;
    }
  },

  async getProduct(id) {
    const product = await productRepository.findById(id);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return product;
  },

  async createProduct(fields) {
    return productRepository.create(fields);
  },

  async updateProduct(id, fields) {
    try {
      return await productRepository.update(id, fields);
    } catch (err) {
      // Prisma throws P2025 when the record doesn't exist
      if (err.code === 'P2025') throw Object.assign(new Error('Product not found'), { status: 404 });
      throw err;
    }
  },

  async deleteProduct(id) {
    try {
      await productRepository.delete(id);
    } catch (err) {
      if (err.code === 'P2025') throw Object.assign(new Error('Product not found'), { status: 404 });
      throw err;
    }
  },

  // ── Service-to-service operations ─────────────────────────────────────────

  async decrementStock(id, quantity) {
    const product = await productRepository.findById(id);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (product.stock < quantity) {
      throw Object.assign(
        new Error(`Insufficient stock for "${product.name}" (available: ${product.stock})`),
        { status: 400 }
      );
    }
    return productRepository.decrementStock(id, quantity);
  },

  async releaseStock(id, quantity) {
    const product = await productRepository.findById(id);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return productRepository.incrementStock(id, quantity);
  },
};

module.exports = productService;
