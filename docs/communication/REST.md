# Service-to-Service Communication — REST

REST (HTTP/JSON) is the default choice for synchronous, request-response communication between services. In express-cart this pattern is used whenever one service needs an immediate answer before it can continue — for example, validating stock before placing an order.

---

## Services Involved

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cart Service  │     │  Order Service  │     │ Payment Service │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         │   HTTP/JSON (REST)    │                        │
         ▼                       ▼                        ▼
┌─────────────────┐     ┌─────────────────┐
│ Product Service │     │ Product Service │
└─────────────────┘     └─────────────────┘
```

---

## Flow 1 — Cart adds an item (Cart Service → Product Service)

When a user adds a product to the cart, the Cart Service calls the Product Service to validate the product exists and fetch the current price.

```
Client
  │
  │  POST /cart/items  { productId, quantity }
  ▼
Cart Service
  │
  ├─── GET /products/:id ──────────────────────────────► Product Service
  │                                                            │
  │                                                     Lookup in DB
  │                                                            │
  │◄─── 200 { id, name, price, stock } ────────────────────────┤
  │
  ├─ stock >= quantity?
  │     NO  → 400 Insufficient stock
  │     YES ↓
  │
  ├─ upsertCartItem({ productId, quantity, priceAtTime: price })
  │
  └──► 200 { cart }
```

### Request / Response

**Cart Service → Product Service**
```http
GET /products/prod_abc123
Authorization: Bearer <service-token>
```

```json
{
  "id": "prod_abc123",
  "name": "Wireless Headphones",
  "price": 49.99,
  "stock": 12,
  "category": "Electronics"
}
```

### Code — HTTP client wrapper

```js
// src/clients/productClient.js
const axios = require('axios');
const { CircuitBreaker } = require('../utils/circuitBreaker');

const http = axios.create({
  baseURL: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001',
  timeout: 5000,
  headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN}` },
});

const cb = new CircuitBreaker('product-service-rest', {
  failureThreshold: 3,
  windowMs: 30_000,
  recoveryTimeoutMs: 60_000,
});

const productClient = {
  async getProduct(id) {
    return cb.exec(async () => {
      const { data } = await http.get(`/products/${id}`);
      return data;
    });
  },

  async listProducts(query = {}) {
    return cb.exec(async () => {
      const { data } = await http.get('/products', { params: query });
      return data;
    });
  },
};

module.exports = productClient;
```

> The circuit breaker (already in this project) wraps every outbound call — if Product Service starts failing, Cart Service falls back gracefully rather than cascading.

---

## Flow 2 — Checkout (Order Service → Product Service)

Before creating an order the Order Service must confirm live stock levels and lock quantities. This is a **read-then-write** pattern that runs inside a DB transaction.

```
Client
  │
  │  POST /orders  (checkout)
  ▼
Order Service
  │
  ├─ for each cart item:
  │     GET /products/:id ──────────────────────────────► Product Service
  │     ◄── { id, stock, price } ────────────────────────────────────────┤
  │
  ├─ stock < quantity?  →  400 Insufficient stock for "<name>"
  │
  ├─ BEGIN DB TRANSACTION
  │     decrement stock for each product (via Product Service or direct DB)
  │     create Order + OrderItems
  │     clear Cart
  │  COMMIT
  │
  └──► 201 { order }
```

### Retry strategy

Stock checks are idempotent reads — safe to retry. Writes (decrement + order create) must be **idempotent** via a client-supplied `Idempotency-Key` header.

```js
// Retry with exponential back-off (axios-retry or manual)
async function withRetry(fn, retries = 3, delayMs = 300) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = !err.response || err.response.status >= 500;
      if (!isRetryable || attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

// Usage
const product = await withRetry(() => productClient.getProduct(item.productId));
```

---

## Flow 3 — Payment webhook (Payment Service → Order Service)

Stripe sends a webhook to the Payment Service. The Payment Service then calls the Order Service to update the order status synchronously.

```
Stripe
  │
  │  POST /payments/webhook  (payment_intent.succeeded)
  ▼
Payment Service
  │
  ├─ verify Stripe webhook signature
  ├─ extract paymentIntentId from event
  │
  ├─── PATCH /orders/:id/payment-status ──────────────► Order Service
  │    { paymentStatus: "paid", status: "processing" }
  │
  │◄─── 200 { order } ─────────────────────────────────────────────────┤
  │
  └──► 200 { received: true }  →  Stripe
```

### Request

```http
PATCH /orders/ord_xyz789/payment-status
Authorization: Bearer <service-token>
Content-Type: application/json

{
  "paymentStatus": "paid",
  "status": "processing",
  "paymentIntentId": "pi_3NkD8..."
}
```

---

## Error Handling Matrix

| Scenario | HTTP Status | Action |
|---|---|---|
| Product Service down | 503 | Circuit opens → fallback / fail fast |
| Product not found | 404 | Return error to client immediately |
| Insufficient stock | 400 | Return error to client immediately |
| Network timeout | — | Retry up to 3× with back-off |
| 5xx from Product Service | 500+ | Retry (idempotent reads), fail (writes) |
| Auth failure (bad service token) | 401 | Do not retry — alert ops |

---

## Security

All service-to-service calls use a shared **service token** (a long-lived JWT signed with a separate secret `SERVICE_JWT_SECRET`). This is different from the user JWT and never exposed to clients.

```js
// Middleware: verify inbound service-to-service calls
function authenticateService(req, res, next) {
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: 'Service token required' });
  try {
    const payload = jwt.verify(token, process.env.SERVICE_JWT_SECRET);
    if (payload.type !== 'service') throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Invalid service token' });
  }
}
```

---

## Environment Variables

```env
PRODUCT_SERVICE_URL=http://product-service:3001
ORDER_SERVICE_URL=http://order-service:3002
SERVICE_TOKEN=<long-lived-service-jwt>
SERVICE_JWT_SECRET=<secret-for-signing-service-tokens>
```

---

## When to use REST

- You need an **immediate response** before proceeding (stock check, price lookup)
- The operation is **short-lived** (< 5 s)
- The caller needs to **react to the result** (pass/fail, redirect)
- Both services are available and the latency is acceptable

> For operations that can happen **asynchronously** (sending emails, updating analytics), use a [Message Queue](./MESSAGE_QUEUE.md) instead.
