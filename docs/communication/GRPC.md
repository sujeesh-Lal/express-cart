# Service-to-Service Communication — gRPC

gRPC uses HTTP/2 + Protocol Buffers (binary serialisation). It is faster and more efficient than REST/JSON for high-frequency internal calls — for example, the Cart Service validating prices on every item add, or the Order Service reserving stock during checkout.

---

## Why gRPC over REST here

| | REST/JSON | gRPC |
|---|---|---|
| Protocol | HTTP/1.1 | HTTP/2 (multiplexed) |
| Payload | JSON (text) | Protobuf (binary, ~5× smaller) |
| Schema | Optional (OpenAPI) | Enforced (.proto) |
| Streaming | Manual (SSE/WS) | Native (server/client/bi-di) |
| Latency | Higher | Lower |
| Best for | Public APIs, webhooks | Internal high-frequency calls |

---

## Services Involved

```
┌─────────────────┐  gRPC  ┌──────────────────────┐
│  Cart Service   │───────►│   Product Service    │
│  (gRPC client)  │        │   (gRPC server)      │
└─────────────────┘        └──────────────────────┘

┌─────────────────┐  gRPC  ┌──────────────────────┐
│  Order Service  │───────►│   Product Service    │
│  (gRPC client)  │        │   (gRPC server)      │
└─────────────────┘        └──────────────────────┘
```

---

## Proto Definition

```protobuf
// proto/product.proto
syntax = "proto3";

package product;

service ProductService {
  // Get a single product by ID
  rpc GetProduct (GetProductRequest) returns (ProductResponse);

  // Validate and reserve stock for multiple items (used during checkout)
  rpc ReserveStock (ReserveStockRequest) returns (ReserveStockResponse);

  // Release previously reserved stock (on cancel/failure)
  rpc ReleaseStock (ReleaseStockRequest) returns (ReleaseStockResponse);

  // Server-streaming: push live price updates to subscribers
  rpc WatchPrice (WatchPriceRequest) returns (stream PriceUpdate);
}

// ── Messages ─────────────────────────────────────────────────────────────────

message GetProductRequest {
  string id = 1;
}

message ProductResponse {
  string   id          = 1;
  string   name        = 2;
  double   price       = 3;
  int32    stock       = 4;
  string   category    = 5;
  bool     found       = 6;
}

message ReserveStockItem {
  string id       = 1;
  int32  quantity = 2;
}

message ReserveStockRequest {
  string                  order_id = 1;
  repeated ReserveStockItem items  = 2;
}

message ReservedItem {
  string id            = 1;
  string name          = 2;
  double price_at_time = 3;
  int32  quantity      = 4;
}

message ReserveStockResponse {
  bool                  success       = 1;
  string                error_message = 2;   // non-empty on failure
  repeated ReservedItem items         = 3;
}

message ReleaseStockRequest {
  string                  order_id = 1;
  repeated ReserveStockItem items  = 2;
}

message ReleaseStockResponse {
  bool success = 1;
}

message WatchPriceRequest {
  string product_id = 1;
}

message PriceUpdate {
  string product_id = 1;
  double old_price  = 2;
  double new_price  = 3;
  string updated_at = 4;
}
```

---

## Flow 1 — Cart adds item (Cart Service calls GetProduct)

```
Cart Service (client)                     Product Service (server)
      │                                           │
      │  gRPC GetProduct({ id: "prod_abc" })      │
      │──────────────────────────────────────────►│
      │                                    DB lookup
      │                                           │
      │◄── ProductResponse { id, price, stock } ──┤
      │
      ├─ stock >= quantity? NO → 400
      │                    YES ↓
      └─ upsertCartItem({ priceAtTime: response.price })
```

### gRPC Server — Product Service

```js
// src/grpc/productGrpcServer.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const productRepository = require('../repositories/productRepository');
const prisma = require('../config/prismaClient');

const PROTO_PATH = path.join(__dirname, '../../proto/product.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const { product: pkg } = grpc.loadPackageDefinition(packageDef);

// ── RPC Handlers ──────────────────────────────────────────────────────────────

async function getProduct(call, callback) {
  try {
    const product = await productRepository.findById(call.request.id);
    if (!product) {
      return callback(null, { found: false });
    }
    callback(null, {
      id:       product.id,
      name:     product.name,
      price:    product.price,
      stock:    product.stock,
      category: product.category,
      found:    true,
    });
  } catch (err) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
}

async function reserveStock(call, callback) {
  const { order_id, items } = call.request;
  try {
    const reserved = await prisma.$transaction(async (tx) => {
      const result = [];
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.id } });
        if (!product || product.stock < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.id}`);
        }
        await tx.product.update({
          where: { id: item.id },
          data:  { stock: { decrement: item.quantity } },
        });
        result.push({
          id:            product.id,
          name:          product.name,
          price_at_time: product.price,
          quantity:      item.quantity,
        });
      }
      return result;
    });
    callback(null, { success: true, items: reserved });
  } catch (err) {
    callback(null, { success: false, error_message: err.message, items: [] });
  }
}

async function releaseStock(call, callback) {
  const { items } = call.request;
  try {
    await prisma.$transaction(
      items.map(item =>
        prisma.product.update({
          where: { id: item.id },
          data:  { stock: { increment: item.quantity } },
        })
      )
    );
    callback(null, { success: true });
  } catch (err) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
}

function watchPrice(call) {
  // Push a price update every 30 s (replace with real event subscription)
  const interval = setInterval(async () => {
    const product = await productRepository.findById(call.request.product_id);
    if (product) {
      call.write({
        product_id: product.id,
        old_price:  product.price,
        new_price:  product.price,
        updated_at: new Date().toISOString(),
      });
    }
  }, 30_000);

  call.on('cancelled', () => clearInterval(interval));
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

function startGrpcServer(port = process.env.GRPC_PORT || 50051) {
  const server = new grpc.Server();
  server.addService(pkg.ProductService.service, {
    getProduct,
    reserveStock,
    releaseStock,
    watchPrice,
  });
  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(), // use createSsl() in production
    (err, boundPort) => {
      if (err) throw err;
      console.info(`[gRPC] Product service listening on :${boundPort}`);
    }
  );
  return server;
}

module.exports = { startGrpcServer };
```

### gRPC Client — Cart / Order Service

```js
// src/grpc/productGrpcClient.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '../../proto/product.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const { product: pkg } = grpc.loadPackageDefinition(packageDef);

// Reuse a single channel (HTTP/2 multiplexes all calls over it)
const client = new pkg.ProductService(
  process.env.PRODUCT_GRPC_ADDR || 'localhost:50051',
  grpc.credentials.createInsecure()
);

// Promisify helpers
function getProduct(id) {
  return new Promise((resolve, reject) => {
    client.getProduct({ id }, (err, res) => err ? reject(err) : resolve(res));
  });
}

function reserveStock(orderId, items) {
  return new Promise((resolve, reject) => {
    client.reserveStock({ order_id: orderId, items }, (err, res) =>
      err ? reject(err) : resolve(res)
    );
  });
}

function releaseStock(orderId, items) {
  return new Promise((resolve, reject) => {
    client.releaseStock({ order_id: orderId, items }, (err, res) =>
      err ? reject(err) : resolve(res)
    );
  });
}

module.exports = { getProduct, reserveStock, releaseStock };
```

---

## Flow 2 — Checkout (Order Service calls ReserveStock)

```
Order Service (client)                    Product Service (server)
      │                                           │
      │  gRPC ReserveStock({                      │
      │    order_id: "ord_xyz",                   │
      │    items: [                               │
      │      { id: "p1", quantity: 2 },           │
      │      { id: "p2", quantity: 1 }            │
      │    ]                                      │
      │  })                                       │
      │──────────────────────────────────────────►│
      │                                    BEGIN TRANSACTION
      │                                    check stock p1 ✓
      │                                    decrement stock p1
      │                                    check stock p2 ✓
      │                                    decrement stock p2
      │                                    COMMIT
      │                                           │
      │◄── ReserveStockResponse {                 │
      │      success: true,                       │
      │      items: [{ name, price_at_time, qty }]│
      │    } ─────────────────────────────────────┤
      │
      ├─ success? NO  → ReleaseStock (compensating call) → 400 to client
      │           YES → create Order in DB → 201 to client
```

---

## Flow 3 — Server Streaming (WatchPrice)

```
Cart Service (client)                     Product Service (server)
      │                                           │
      │  gRPC WatchPrice({ product_id: "p1" })   │
      │──────────────────────────────────────────►│
      │                                     subscribe to price events
      │◄── PriceUpdate { old: 49.99, new: 44.99 }─┤  (whenever price changes)
      │◄── PriceUpdate { old: 44.99, new: 47.50 }─┤
      │           ... stream stays open ...       │
      │  cancel()                                 │
      │──────────────────────────────────────────►│
      │                                     cleanup interval
```

---

## Setup

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

```env
GRPC_PORT=50051
PRODUCT_GRPC_ADDR=product-service:50051
```

Start the gRPC server alongside the HTTP server in `src/app.js`:

```js
const { startGrpcServer } = require('./grpc/productGrpcServer');
startGrpcServer();
```

---

## Error Handling

gRPC uses its own status codes — map them to HTTP in the REST gateway:

| gRPC Status | Meaning | HTTP Equivalent |
|---|---|---|
| `OK` | Success | 200 |
| `NOT_FOUND` | Resource missing | 404 |
| `INVALID_ARGUMENT` | Bad input | 400 |
| `ALREADY_EXISTS` | Duplicate | 409 |
| `FAILED_PRECONDITION` | Insufficient stock | 400 |
| `INTERNAL` | Server error | 500 |
| `UNAVAILABLE` | Service down | 503 |
| `DEADLINE_EXCEEDED` | Timeout | 504 |

```js
// Map gRPC error → HTTP in Express error handler
if (err.code !== undefined) {
  const httpMap = { 5: 404, 3: 400, 6: 409, 9: 400, 13: 500, 14: 503, 4: 504 };
  res.status(httpMap[err.code] || 500).json({ error: err.message });
  return;
}
```

---

## When to use gRPC

- High-frequency **internal** calls where JSON overhead matters (price checks on every cart add)
- Strong **schema enforcement** is required between teams/services
- **Streaming** is needed (live price updates, inventory feeds)
- Both services are under your control (not a public API)

> For public-facing endpoints keep REST. For async operations use a [Message Queue](./MESSAGE_QUEUE.md).
