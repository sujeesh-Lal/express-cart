# Testing Service Communication — Postman Guide

This guide walks through testing all three communication patterns using Postman.

---

## Prerequisites

```bash
# 1. Start infrastructure
docker compose up -d          # postgres + redis

# 2. Install dependencies
npm install

# 3. Start the server
npm run dev
```

Server should print:
```
REST API  → http://localhost:3000
GraphQL   → http://localhost:3000/graphql
[gRPC]    Product service listening on :50051
[Redis]   connected
```

---

## Import into Postman

1. **Collection** — File → Import → `postman/express-cart.postman_collection.json`
2. **Environment** — Environments → Import → `postman/express-cart.postman_environment.json`
3. Select **"express-cart (local)"** as the active environment (top-right dropdown)

---

## Step 0 — Generate a Service Token

The REST service-to-service endpoints (`/products/:id/decrement-stock`, `/release-stock`) require a service JWT. Generate one once:

```bash
node scripts/generate-service-token.js
```

Output:
```
Token (copy this into Postman → service_token):

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Paste the token into **Postman → Environments → express-cart (local) → `service_token`**.

---

## 1. Testing REST Service-to-Service

Run the requests in the **"1. REST — Service-to-Service"** folder in order.

### Flow

```
Postman ──────────────────────────────────────────────► Express API
          POST /products/:id/decrement-stock
          Authorization: Bearer <service_token>
                                                          ↓
                                              authenticateService middleware
                                              verifies JWT type === 'service'
                                                          ↓
                                              productService.decrementStock()
                                                          ↓
                                              200 { id, stock: 95, ... }
```

### Requests

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /products/:id/decrement-stock` with service token | 200, stock = 95 |
| 2 | Same request **without** any token | 401 |
| 3 | Same request with **user JWT** (not service) | 403 |
| 4 | `POST /products/:id/release-stock` with service token | 200, stock = 100 |
| 5 | Decrement with `quantity: 9999` (over stock) | 400, error mentions "stock" |

### What to verify

- ✅ Service token is accepted, user JWT is rejected with 403
- ✅ Stock count changes correctly between decrement and release
- ✅ Over-stock returns a clear 400 error message

---

## 2. Testing gRPC (Postman native gRPC client)

Postman supports gRPC natively. The server listens on port **50051**.

### Setup (one time)

1. Click **New → gRPC Request**
2. Set URL: `localhost:50051` (no `http://`)
3. Click **"Select a method"** → **"Import a .proto file"**
4. Browse to `proto/product.proto` in your project → click **Import**
5. You will see all 4 RPCs listed: `GetProduct`, `ReserveStock`, `ReleaseStock`, `WatchPrice`

### 2a. GetProduct

Select method: `ProductService / GetProduct`

**Request message:**
```json
{
  "id": "<paste a product_id from env>"
}
```

**Expected response:**
```json
{
  "id": "...",
  "name": "Test Headphones",
  "price": 49.99,
  "stock": 100,
  "category": "Electronics",
  "found": true
}
```

**Test — product not found:**
```json
{ "id": "non-existent-id" }
```
Expected: `{ "found": false }`

---

### 2b. ReserveStock

Select method: `ProductService / ReserveStock`

**Request message:**
```json
{
  "order_id": "test-order-001",
  "items": [
    { "id": "<product_id>", "quantity": 3 }
  ]
}
```

**Expected response:**
```json
{
  "success": true,
  "error_message": "",
  "items": [
    { "id": "...", "name": "Test Headphones", "price_at_time": 49.99, "quantity": 3 }
  ]
}
```

Verify the stock dropped by 3: call `GetProduct` again and check `stock` is now 97.

**Test — insufficient stock:**
```json
{
  "order_id": "test-order-002",
  "items": [{ "id": "<product_id>", "quantity": 9999 }]
}
```
Expected: `{ "success": false, "error_message": "Insufficient stock for..." }`

---

### 2c. ReleaseStock

Select method: `ProductService / ReleaseStock`

**Request message:**
```json
{
  "order_id": "test-order-001",
  "items": [
    { "id": "<product_id>", "quantity": 3 }
  ]
}
```

**Expected response:** `{ "success": true }`

Verify: call `GetProduct` again — stock should be back to 100.

---

### 2d. WatchPrice (server-streaming)

Select method: `ProductService / WatchPrice`

**Request message:**
```json
{ "product_id": "<product_id>" }
```

Click **Invoke** — the stream stays open. In another Postman tab (or via the REST API), update the product's price. The server will emit a `PriceUpdate` message to this stream:

```json
{
  "product_id": "...",
  "old_price": 49.99,
  "new_price": 44.99,
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

To trigger a price update from the REST API:
```http
PUT /products/{{product_id}}
Authorization: Bearer {{access_token}}
Content-Type: application/json

{ "price": 44.99 }
```

> **Note:** To emit the event to the stream you also need to call `emitPriceChange()` in `productGrpcServer.js` from the update handler. The stub is wired — just connect it to your `updateProduct` service method.

Click **Cancel** to end the stream.

---

## 3. Testing Message Queue

You cannot see BullMQ queues directly from Postman, but you can **trigger jobs via the REST API** and observe them being processed in the server logs.

Run the requests in the **"2. Message Queue — Trigger via API"** folder.

### 3a. order.placed — checkout triggers 3 workers

```
POST /orders  →  orderQueue.add('order.placed', { orderId, items, ... })
                      │
          ┌───────────┼───────────────┐
          ▼           ▼               ▼
  inventoryWorker  notificationWorker  analyticsWorker
```

After calling **Checkout**, watch the server terminal:

```
[notificationWorker:order.events] ✓ order.placed #1
[inventoryWorker] ✓ order.placed #1
[analyticsWorker] ✓ order.placed #1
[email] → user-xxx@example.com | Order confirmed — #ord_...
[warehouse] decrement product=... qty=2
[analytics] track "Order Placed" { orderId: ..., revenue: 99.98 }
```

### 3b. order.cancelled — cancel triggers inventory restore + email

After calling **Cancel order**, watch for:

```
[notificationWorker:order.events] ✓ order.cancelled #2
[inventoryWorker] ✓ order.cancelled #2
[email] → user-xxx@example.com | Order cancelled — #ord_...
[warehouse] increment product=... qty=2
```

### 3c. payment.succeeded — webhook triggers orderWorker + notificationWorker

After calling **Payment webhook**, watch for:

```
[orderWorker] ✓ payment.succeeded #3
[notificationWorker:payment.events] ✓ payment.succeeded #3
[orderWorker] ✓ order ord_... marked as paid → processing
[email] → user-xxx@example.com | Payment receipt — $49.99
```

Then call **Verify order status** — the test assertion confirms `paymentStatus === 'paid'` was set by the worker (not by the webhook handler directly).

---

## 4. Session (Redis) — Bonus tests

The **"3. Session (Redis)"** folder verifies the Redis session store:

| # | Request | Expected |
|---|---------|----------|
| 1 | `GET /users/me` with valid token | 200 |
| 2 | `POST /auth/logout` with refreshToken + sessionId | 200 |
| 3 | `GET /users/me` with same token (session deleted) | 401 "Session expired or logged out" |

This confirms that logging out immediately invalidates the JWT even before it expires — the Redis session key is deleted and the middleware rejects the token.

---

## Environment Variables Reference

| Variable | Set by | Used in |
|---|---|---|
| `base_url` | Manual (default: `http://localhost:3000`) | All REST requests |
| `grpc_url` | Manual (default: `localhost:50051`) | gRPC requests |
| `access_token` | Login test script | All authenticated requests |
| `refresh_token` | Login test script | Logout, refresh |
| `session_id` | Login test script | Logout |
| `service_token` | `node scripts/generate-service-token.js` | decrement/release-stock |
| `product_id` | Create product test script | All product/cart/order tests |
| `order_id` | Checkout test script | Cancel, payment, verify |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| gRPC "Connection refused" | gRPC server not started | Check `[gRPC] Product service listening` in logs |
| 401 on service endpoints | `service_token` env var empty | Run `node scripts/generate-service-token.js` |
| 403 on service endpoints | Using user JWT instead of service token | Service token has `type: service` in payload |
| Workers not logging | Redis not running | `docker compose up -d` |
| `order.placed` job missing | BullMQ not installed | `npm install` |
| `Session expired` immediately | Redis not running | `docker compose up -d` |
