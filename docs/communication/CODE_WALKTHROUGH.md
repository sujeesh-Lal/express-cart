# Service-to-Service Communication — Code Walkthrough

This document traces the exact code path for each communication pattern through every component: route → middleware → controller → service → client/server → worker. Use it as a reference when debugging, extending, or onboarding.

---

## Table of Contents

1. [Pattern Overview](#pattern-overview)
2. [REST — HTTP service-to-service](#1-rest--http-service-to-service)
3. [gRPC — Protocol Buffers over HTTP/2](#2-grpc--protocol-buffers-over-http2)
4. [Message Queue — BullMQ over Redis](#3-message-queue--bullmq-over-redis)
5. [How the Three Patterns Interact at Checkout](#4-how-the-three-patterns-interact-at-checkout)

---

## Pattern Overview

```
Env var set?               Pattern chosen
─────────────────────────────────────────────────────────────
PRODUCT_GRPC_ADDR          gRPC  (highest priority)
PRODUCT_SERVICE_URL        REST  (second priority)
(neither)                  Local Prisma transaction (monolith)

BullMQ always runs         Message Queue for async fan-out
```

All three modes are selected at **runtime** inside `orderService.checkout()` — no code changes required to switch between them.

---

## 1. REST — HTTP Service-to-Service

### What it does

Order Service calls Product Service over HTTP to validate and decrement stock. A service JWT authenticates the call. A circuit breaker + retry wrapper protects outbound calls from cascading failures.

### Flow diagram

```
[Order Service]                         [Product Service]
     │
     │  POST /orders  (user JWT)
     ▼
orderController.checkout()
     │
     ▼
orderService.checkout(userId)           ← picks REST because PRODUCT_SERVICE_URL is set
     │
     ├─ Step 1: validate stock
     │     productHttpClient.getProduct(id)
     │          └─ axios GET /products/:id
     │               └─ CircuitBreaker.exec()
     │                    └─ withRetry()  → HTTP GET /products/:id ──────────►
     │                                                              authenticateService (no — GET is public)
     │                                                              productController.getProduct()
     │                                                              productService.getProduct()
     │                                                              productRepository.findById()
     │                                                              ◄── { id, name, stock, price, ... }
     │
     ├─ Step 2: decrement stock
     │     productHttpClient.decrementStock(id, qty)
     │          └─ axios POST /products/:id/decrement-stock ──────────────────►
     │                                                              authenticateService middleware
     │                                                                  jwt.verify(token, SERVICE_JWT_SECRET)
     │                                                                  payload.type === 'service' ✓
     │                                                                  req.callerService = 'order-service'
     │                                                              productController.decrementStock()
     │                                                                  validates quantity >= 1
     │                                                              productService.decrementStock()
     │                                                                  findById → stock check
     │                                                                  productRepository.decrementStock()
     │                                                                  ◄── { id, stock: 95, ... }
     │
     ├─ Step 3: create order in DB (Prisma transaction)
     │     prisma.$transaction → order.create + cartItem.deleteMany
     │
     ├─ Step 4 (on DB failure): compensating rollback
     │     productHttpClient.releaseStock(id, qty)  ← for each decremented item
     │     Promise.allSettled() — never throws, best-effort
     │
     └─ Step 5: publish to MQ
          orderQueue.add('order.placed', { orderId, items, ... })
```

### Key files and their roles

**`src/clients/productClient.js`** — the outbound HTTP client

```js
// Single axios instance — baseURL + service token applied to every request
const http = axios.create({
  baseURL: services.productServiceUrl,  // PRODUCT_SERVICE_URL env var
  timeout: 5000,
  headers: { Authorization: `Bearer ${services.serviceToken}` },
});

// Every call goes through: circuit breaker → retry → axios
async function call(fn) {
  return cb.exec(() => withRetry(fn, { retries: 3, delayMs: 300 }));
}
```

**`src/utils/circuitBreaker.js`** — protects outbound calls

```
States: CLOSED → OPEN → HALF_OPEN → CLOSED

CLOSED:    pass through; count failures in rolling 30s window
OPEN:      throw CircuitOpenError immediately (no HTTP call made)
HALF_OPEN: let one probe call through — success resets to CLOSED,
           failure re-trips to OPEN
```

The circuit trips when `failures.length >= failureThreshold (3)` inside the `windowMs (30s)`.

**`src/utils/retry.js`** — retries transient failures

```js
// Delay: attempt 1 → 300ms, attempt 2 → 600ms, attempt 3 → 900ms
// Only retries: network errors (no .response) and 5xx
// Never retries: 4xx (400/401/403/404 — won't change on retry)
```

**`src/middleware/authenticateService.js`** — guards inbound service calls

```js
// Inbound: Order Service → Product Service
// Extracts Bearer token, calls jwt.verify with SERVICE_JWT_SECRET
// Checks payload.type === 'service'
// Attaches req.callerService = payload.name
// Returns 401 (missing/invalid token) or 403 (user JWT used instead)
```

**`src/routes/productRoutes.js`** — route guards

```js
// Public routes (no auth required):
router.get('/',    productController.listProducts);
router.get('/:id', productController.getProduct);

// Service-to-service routes (service JWT required):
router.post('/:id/decrement-stock', authenticateService, productController.decrementStock);
router.post('/:id/release-stock',   authenticateService, productController.releaseStock);
```

**`src/controllers/productController.js`** — input validation

```js
// decrementStock: validates quantity >= 1, then delegates to productService
// releaseStock:   validates quantity >= 1, then delegates to productService
```

**`src/services/productService.js`** — business logic

```js
async decrementStock(id, quantity) {
  const product = await productRepository.findById(id);
  // 404 if not found
  // 400 if product.stock < quantity
  return productRepository.decrementStock(id, quantity);  // Prisma update
}

async releaseStock(id, quantity) {
  const product = await productRepository.findById(id);
  return productRepository.incrementStock(id, quantity);  // Prisma update
}
```

### What happens when the circuit is OPEN

```
productHttpClient.getProduct(id)
  └─ cb.exec(...)
       └─ state === OPEN → throws CircuitOpenError { status: 503 }
            └─ orderService catches → propagates 503 to the user
                                      (or caller uses mock fallback for listProducts)
```

The circuit resets automatically after `recoveryTimeoutMs (60s)` by probing with a single HALF_OPEN call.

---

## 2. gRPC — Protocol Buffers over HTTP/2

### What it does

Order Service calls Product Service via gRPC instead of HTTP. `ReserveStock` is a single atomic RPC that validates and decrements all cart items in one Prisma transaction — eliminating the N sequential REST calls needed for stock checks.

### Flow diagram

```
[Order Service]                              [Product Service — gRPC server :50051]
     │
     │  POST /orders  (user JWT)
     ▼
orderService.checkout(userId)                ← picks gRPC because PRODUCT_GRPC_ADDR is set
     │
     ├─ Step 1: reserve stock atomically
     │     productGrpcClient.reserveStock(orderId, items)
     │          └─ getClient()  ← lazy-init: new pkg.ProductService(addr, insecure)
     │          └─ client.reserveStock(
     │                  { order_id, items: [{ id, quantity }, ...] },
     │                  { deadline: now + 10s }
     │             )
     │             ─────── HTTP/2 binary frame ───────────────────────────────►
     │                                                         reserveStock() handler
     │                                                           prisma.$transaction(async tx => {
     │                                                             for each item:
     │                                                               tx.product.findUnique()
     │                                                               // throws if not found
     │                                                               // throws if stock < qty
     │                                                               tx.product.update({ stock: -qty })
     │                                                               push to result[]
     │                                                           })
     │                                                           callback(null, {
     │                                                             success: true,
     │                                                             items: [{ id, name,
     │                                                                       price_at_time, qty }]
     │                                                           })
     │             ◄── ReserveStockResponse ──────────────────────────────────
     │
     │     if !reservation.success → throw 400 (stock error message from server)
     │
     ├─ Step 2: create order in local DB
     │     prisma.$transaction → order.create + cartItem.deleteMany
     │
     ├─ Step 3 (on DB failure): compensating rollback via gRPC
     │     productGrpcClient.releaseStock(orderId, items)
     │          └─ client.releaseStock({ order_id, items }, { deadline: now + 10s })
     │             ─────── HTTP/2 binary frame ───────────────────────────────►
     │                                                         releaseStock() handler
     │                                                           prisma.$transaction(
     │                                                             items.map(i =>
     │                                                               prisma.product.update({
     │                                                                 stock: { increment: qty }
     │                                                               })
     │                                                             )
     │                                                           )
     │             ◄── { success: true } ─────────────────────────────────────
     │
     └─ Step 4: publish to MQ
          orderQueue.add('order.placed', { orderId, items, ... })
```

### Key files and their roles

**`proto/product.proto`** — the contract (source of truth for both sides)

```protobuf
service ProductService {
  rpc GetProduct    (GetProductRequest)   returns (ProductResponse);
  rpc ReserveStock  (ReserveStockRequest) returns (ReserveStockResponse);
  rpc ReleaseStock  (ReleaseStockRequest) returns (ReleaseStockResponse);
  rpc WatchPrice    (WatchPriceRequest)   returns (stream PriceUpdate);
}
```

Both `productGrpcServer.js` and `productGrpcClient.js` call `protoLoader.loadSync(PROTO_PATH)` at module load time — they always agree on the message shapes because they read the same file.

**`src/grpc/productGrpcServer.js`** — the gRPC server (runs on Product Service side)

```js
// Startup (called from app.js):
const server = new grpc.Server();
server.addService(pkg.ProductService.service, {
  getProduct,
  reserveStock,
  releaseStock,
  watchPrice,
});
server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), cb);

// ReserveStock handler — entire logic runs inside one Prisma transaction:
async function reserveStock(call, callback) {
  const reserved = await prisma.$transaction(async (tx) => {
    for (const item of call.request.items) {
      const product = await tx.product.findUnique(...);
      // Throws inside transaction → Prisma rolls back ALL updates
      if (!product)              throw error(NOT_FOUND);
      if (stock < item.quantity) throw error(FAILED_PRECONDITION);
      await tx.product.update({ stock: { decrement: item.quantity } });
      result.push({ id, name, price_at_time, quantity });
    }
    return result;
  });
  callback(null, { success: true, items: reserved });
  // On catch: callback(null, { success: false, error_message: err.message })
  //           (structured failure — not a gRPC error — so client can inspect it)
}
```

**`src/grpc/productGrpcClient.js`** — the gRPC client (runs on Order/Cart Service side)

```js
// Lazy singleton channel — HTTP/2 connection reused across all calls
let _client = null;
function getClient() {
  if (!_client) {
    _client = new pkg.ProductService(grpcConfig.productAddr, insecure);
  }
  return _client;
}

// Every call wraps the callback API in a Promise:
reserveStock(orderId, items) {
  return new Promise((resolve, reject) => {
    getClient().reserveStock(
      { order_id: orderId, items },
      { deadline: new Date(Date.now() + 10000) },  // 10s deadline
      (err, res) => {
        if (err) return reject(grpcError(err));     // maps gRPC codes to HTTP status
        resolve(res);
      }
    );
  });
}
```

**gRPC status → HTTP status mapping**

```
NOT_FOUND           → 404
INVALID_ARGUMENT    → 400
FAILED_PRECONDITION → 400
ALREADY_EXISTS      → 409
INTERNAL            → 500
UNAVAILABLE         → 503
DEADLINE_EXCEEDED   → 504
```

**`src/grpc/productGrpcServer.js` — WatchPrice (server-streaming)**

```js
// In-process EventEmitter used as pub/sub
const priceEvents = new EventEmitter();

// When a client subscribes:
function watchPrice(call) {
  function onPriceChange({ productId, oldPrice, newPrice }) {
    if (productId !== call.request.product_id) return;
    call.write({ product_id, old_price, new_price, updated_at });
  }
  priceEvents.on('price_change', onPriceChange);
  call.on('cancelled', () => priceEvents.off('price_change', onPriceChange));
}

// Trigger from elsewhere in the codebase:
emitPriceChange(productId, oldPrice, newPrice);
// → all active WatchPrice streams for that productId receive the update
```

### Why gRPC over REST for stock reservation

With REST, N cart items = N sequential HTTP calls (validate × N, then decrement × N). With gRPC, all items are sent in a single `ReserveStock` message and processed in one Prisma transaction. The transaction is all-or-nothing — if item 3 has insufficient stock, items 1 and 2 are automatically rolled back.

---

## 3. Message Queue — BullMQ over Redis

### What it does

After an order is created (regardless of REST, gRPC, or local mode), `orderService` publishes an `order.placed` job to BullMQ. Three independent workers pick it up and process it asynchronously: inventory sync, email notification, and analytics tracking. Neither the HTTP response nor the user waits for any of this.

### Flow diagram — order.placed fan-out

```
POST /orders → orderService.checkout()
     │
     └─ (after DB write)
          orderQueue.add('order.placed', {
            orderId, userId, totalAmount, items, placedAt
          })
               │
               │  Redis LPUSH to 'bull:order.events:wait' list
               │
          ┌────┴─────────────────────────────┐──────────────────────┐
          ▼                                  ▼                      ▼
   inventoryWorker                  notificationWorker        analyticsWorker
   (concurrency: 2)                 (concurrency: 10)         (concurrency: 20)
          │                                  │                      │
          │  job.name === 'order.placed'      │                      │
          │  for each item:                  │  sendEmail({         │  analyticsClient.track(
          │    warehouseClient               │    to: user@...,     │    'Order Placed', {
          │      .decrementStock()           │    subject: "Order   │    orderId, revenue,
          │                                  │     confirmed",      │    itemCount, ...
          │                                  │    body: itemLines   │  })
          │                                  │  })                  │
          ▼                                  ▼                      ▼
   [warehouse API]                    [email provider]       [analytics API]
```

### Flow diagram — payment.succeeded

```
POST /payments/webhook → paymentService.handleWebhook()
     │
     └─ paymentQueue.add('payment.succeeded', {
            paymentIntentId, orderId, userId, amount, currency
        })
               │
          ┌────┴──────────────────────┐
          ▼                           ▼
   orderWorker                notificationWorker
   (concurrency: 5)           (concurrency: 10)
          │                           │
   orderRepository.update(id, {       │  sendEmail({
     paymentStatus: 'paid',           │    subject: 'Payment receipt',
     status: 'processing'             │    body: `We received $49.99 ...`
   })                                 │  })
```

### Key files and their roles

**`src/queues/index.js`** — queue definitions

```js
// Parses REDIS_URL (e.g. redis://localhost:6380) into host/port for BullMQ
function redisConnection() {
  const url = new URL(redisConfig.url);
  return { host: url.hostname, port: Number(url.port) || 6379 };
}

// Global job options applied to every job on every queue:
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,                              // retry up to 3 times on failure
  backoff: { type: 'exponential', delay: 2000 },  // 2s, 4s, 8s
  removeOnComplete: { count: 100 },         // keep last 100 for debugging
  removeOnFail:     { count: 50  },
};

const orderQueue   = new Queue('order.events',   { connection, defaultJobOptions });
const paymentQueue = new Queue('payment.events', { connection, defaultJobOptions });
```

**`src/services/orderService.js`** — publishing events

```js
async function publishOrderPlaced(order) {
  await orderQueue.add('order.placed', {
    orderId:     order.id,
    userId:      order.userId,
    totalAmount: order.totalAmount,
    items:       order.items.map(i => ({
      productId: i.productId,
      name:      i.name,
      quantity:  i.quantity,
      price:     i.priceAtTime,
    })),
    placedAt: new Date().toISOString(),
  });
}
// Called at the end of _checkoutLocal, _checkoutViaGrpc, and _checkoutViaRest
// — the MQ publish happens AFTER the DB write succeeds
```

**`src/utils/idempotency.js`** — prevents duplicate processing

```js
// BullMQ is at-least-once: a worker crash mid-job causes the job to be retried.
// withIdempotency wraps every worker to make processing exactly-once:

function withIdempotency(processor) {
  return async (job) => {
    const key = `processed:${job.queueName}:${job.id}`;

    const already = await redis.get(key);
    if (already) {
      console.info(`[idempotency] skipping duplicate job ${job.queueName}#${job.id}`);
      return;  // job already completed — skip silently
    }

    const result = await processor(job);  // run the real work

    await redis.set(key, '1', 'EX', 86400);  // mark done, 24h TTL
    return result;
  };
}
```

**`src/workers/inventoryWorker.js`** — stock sync to warehouse

```js
const worker = new Worker(
  'order.events',                          // queue name — same as orderQueue
  withIdempotency(async (job) => {
    if (job.name === 'order.placed') {
      for (const item of job.data.items) {
        await warehouseClient.decrementStock(item.productId, item.quantity);
      }
    }
    if (job.name === 'order.cancelled') {
      for (const item of job.data.items) {
        await warehouseClient.incrementStock(item.productId, item.quantity);
      }
    }
  }),
  { connection, concurrency: 2 }           // low — warehouse APIs are rate-limited
);

// Dead-letter monitoring via QueueEvents:
const queueEvents = new QueueEvents('order.events', { connection });
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[DLQ:inventoryWorker] job ${jobId} exhausted retries: ${failedReason}`);
  // TODO: alert ops — stock may be out of sync
});
```

**`src/workers/notificationWorker.js`** — email sending

```js
// Factory pattern — one function creates workers for multiple queues
function createNotificationWorker(queueName) {
  return new Worker(
    queueName,
    withIdempotency(async (job) => {
      const handler = handlers[job.name];  // lookup by event name
      if (!handler) return;                // unknown events silently skipped
      await handler(job);
    }),
    { connection, concurrency: 10 }
  );
}

// Two instances — one per queue
const orderEventsWorker   = createNotificationWorker('order.events');
const paymentEventsWorker = createNotificationWorker('payment.events');

// Handlers map event names to email content:
const handlers = {
  'order.placed':       async (job) => sendEmail({ subject: 'Order confirmed' }),
  'order.cancelled':    async (job) => sendEmail({ subject: 'Order cancelled' }),
  'payment.succeeded':  async (job) => sendEmail({ subject: 'Payment receipt' }),
  'payment.failed':     async (job) => sendEmail({ subject: 'Payment failed' }),
};
```

**`src/workers/orderWorker.js`** — DB update on payment confirmation

```js
// Consumes payment.events (not order.events)
// payment.succeeded: updates order { paymentStatus: 'paid', status: 'processing' }
// payment.failed:    updates order { paymentStatus: 'unpaid' }
// The webhook handler does NOT touch the DB directly — the worker owns DB writes
```

**`src/workers/analyticsWorker.js`** — revenue tracking

```js
// Same queue as inventoryWorker (order.events)
// Both workers receive EVERY job — BullMQ fan-out
// concurrency: 20 — fire-and-forget, analytics failures are non-critical
// QueueEvents dead-letter: console.warn only (no ops alert)
```

**`src/services/paymentService.js`** — webhook entry point

```js
async handleWebhook(rawBody, signature) {
  // MOCK: real Stripe integration replaces the mock event
  if (mockEvent.type === 'payment_intent.succeeded') {
    // Do NOT update DB here — publish to queue instead
    await paymentQueue.add('payment.succeeded', {
      paymentIntentId,
      orderId:  order.id,
      userId:   order.userId,
      amount:   Math.round(order.totalAmount * 100),
      currency: 'usd',
    });
  }
  return { received: true };  // 200 to Stripe immediately — workers are async
}
```

### Why the webhook returns 200 without updating the DB

The webhook handler publishes to the queue and returns `{ received: true }` in the same synchronous pass. Stripe requires a response within 30 seconds. The `orderWorker` updates the DB asynchronously after the response has already been sent. If the worker fails, BullMQ retries with exponential backoff (2s, 4s, 8s). The idempotency key ensures the DB update only happens once even across retries.

---

## 4. How the Three Patterns Interact at Checkout

```
User: POST /orders
         │
         ▼
   orderController.checkout(req, res, next)
         │
         ▼
   orderService.checkout(userId)
         │
         ├── PRODUCT_GRPC_ADDR set?   YES → _checkoutViaGrpc()
         │       │
         │       ├── productGrpcClient.reserveStock()   ─── gRPC call ──►  productGrpcServer.reserveStock()
         │       │        Prisma tx: validate all items + decrement all                └─ Prisma $transaction
         │       │        Returns { success, items }
         │       │
         │       ├── prisma.$transaction → order.create + cart.clear
         │       │
         │       └── (on failure) productGrpcClient.releaseStock()    ─── gRPC call ──►  productGrpcServer.releaseStock()
         │
         ├── PRODUCT_SERVICE_URL set? YES → _checkoutViaRest()
         │       │
         │       ├── productHttpClient.getProduct() × N    ─── REST ──►  GET /products/:id (public)
         │       ├── productHttpClient.decrementStock() × N ─── REST ──►  POST /products/:id/decrement-stock
         │       │        authenticateService middleware validates SERVICE_TOKEN
         │       ├── prisma.$transaction → order.create + cart.clear
         │       └── (on failure) productHttpClient.releaseStock() × N ─── REST ──►  POST /products/:id/release-stock
         │
         └── neither set          → _checkoutLocal()
                 prisma.$transaction (all-in-one: validate + decrement + order.create + cart.clear)
         │
         │  (all three paths converge here)
         ▼
   publishOrderPlaced(order)
         │
         └── orderQueue.add('order.placed', { orderId, items, ... })
                  │
                  │  BullMQ (Redis)
                  │
             ┌────┴────────────────────────────────────┐─────────────────────────────────┐
             ▼                                         ▼                                 ▼
      inventoryWorker                        notificationWorker                  analyticsWorker
      warehouseClient.decrementStock()       sendEmail('Order confirmed')        analyticsClient.track('Order Placed')
```

The MQ step is the same regardless of which checkout path ran. REST and gRPC handle synchronous stock management; the message queue handles asynchronous side-effects that don't need to block the HTTP response.

---

## Component Reference

| File | Layer | Responsibility |
|------|-------|---------------|
| `src/routes/productRoutes.js` | Route | Applies `authenticateService` to stock endpoints |
| `src/middleware/authenticateService.js` | Middleware | Validates inbound service JWT |
| `src/middleware/authenticate.js` | Middleware | Validates user JWT + Redis session |
| `src/controllers/productController.js` | Controller | Input validation, calls service |
| `src/services/productService.js` | Service | Business rules: stock validation, circuit breaker for listProducts |
| `src/services/orderService.js` | Service | Checkout orchestration — selects REST/gRPC/local, publishes MQ events |
| `src/services/paymentService.js` | Service | Webhook handler — publishes to `payment.events` queue |
| `src/clients/productClient.js` | Client | Outbound HTTP to Product Service; circuit breaker + retry |
| `src/grpc/productGrpcClient.js` | Client | Outbound gRPC to Product Service; lazy channel, deadline |
| `src/grpc/productGrpcServer.js` | Server | Handles GetProduct, ReserveStock, ReleaseStock, WatchPrice |
| `proto/product.proto` | Contract | Shared message definitions for both gRPC sides |
| `src/queues/index.js` | Queue | BullMQ queue definitions + Redis connection |
| `src/utils/idempotency.js` | Utility | Exactly-once wrapper for all workers |
| `src/utils/circuitBreaker.js` | Utility | CLOSED/OPEN/HALF_OPEN state machine |
| `src/utils/retry.js` | Utility | Exponential backoff retry for HTTP calls |
| `src/workers/inventoryWorker.js` | Worker | Syncs stock to warehouse on order events |
| `src/workers/notificationWorker.js` | Worker | Sends transactional emails for order + payment events |
| `src/workers/orderWorker.js` | Worker | Updates order DB on payment events |
| `src/workers/analyticsWorker.js` | Worker | Tracks revenue events for analytics |
