# Service-to-Service Communication — Overview

This document describes the three communication patterns used (or planned) in express-cart and when to reach for each one.

---

## Pattern Comparison

| | [REST](./REST.md) | [gRPC](./GRPC.md) | [Message Queue](./MESSAGE_QUEUE.md) |
|---|---|---|---|
| **Style** | Request / Response | Request / Response | Fire and Forget |
| **Protocol** | HTTP/1.1 + JSON | HTTP/2 + Protobuf | Redis (BullMQ) |
| **Coupling** | Synchronous — caller waits | Synchronous — caller waits | Asynchronous — caller continues |
| **Latency** | Medium | Low | Not relevant (background) |
| **Schema** | Optional (OpenAPI) | Enforced (.proto) | Loose (JSON job payload) |
| **Streaming** | No (SSE/WS workaround) | Native (server/client/bi-di) | No |
| **Retries** | Manual (axios-retry) | Manual (deadline/retry policy) | Built-in (BullMQ attempts + backoff) |
| **Best for** | Public APIs, webhooks | High-frequency internal calls | Emails, analytics, slow side-effects |

---

## Decision Tree

```
Does the caller need the result before it can continue?
│
├─ YES ──► Is this an internal high-frequency call OR does schema matter a lot?
│              │
│              ├─ YES ──► gRPC          (price check on every cart add, stock reservation)
│              │
│              └─ NO  ──► REST          (payment webhook, order status update, public API)
│
└─ NO  ──► Message Queue                (order confirmation email, analytics, warehouse sync)
```

---

## How they map to this project

```
                         ┌─────────────────────────────────────────────────────────┐
                         │                  express-cart                           │
                         │                                                         │
  Client ──REST──► ┌─────┴──────┐  ──gRPC──►  ┌─────────────────┐                │
                   │   Cart     │             │  Product Service  │                │
                   │   Service  │  ──gRPC──►  │  (stock / price) │                │
                   └─────┬──────┘             └─────────────────┘                │
                         │ REST                                                   │
                         ▼                                                         │
                   ┌─────────────┐  ──REST──►  ┌─────────────────┐               │
                   │   Order     │             │  Payment Service │               │
                   │   Service   │  ◄──REST─── │  (Stripe hook)  │               │
                   └─────┬───────┘             └─────────────────┘               │
                         │                                                        │
                         │ MQ (order.placed, order.cancelled)                     │
                         ▼                                                        │
              ┌──────────────────────────┐                                        │
              │   Redis — BullMQ broker  │                                        │
              └────┬────────┬────────────┘                                        │
                   │        │        │                                            │
                   ▼        ▼        ▼                                            │
             Inventory  Notify   Analytics                                        │
             Worker     Worker   Worker                                           │
                         │                                                        │
                   ┌─────┴───────────────────────────────────────────────────────┘
                   │  payment.events MQ (payment.succeeded → order worker)
                   ▼
             Order Worker
```

---

## Flows by use case

| Use case | Pattern | Doc |
|---|---|---|
| Add item to cart — fetch product & price | gRPC `GetProduct` | [GRPC.md](./GRPC.md#flow-1) |
| Checkout — reserve stock atomically | gRPC `ReserveStock` | [GRPC.md](./GRPC.md#flow-2) |
| Cancel order — release stock | gRPC `ReleaseStock` | [GRPC.md](./GRPC.md#flow-2) |
| Live price updates | gRPC server-stream `WatchPrice` | [GRPC.md](./GRPC.md#flow-3) |
| Payment webhook → update order status | REST `PATCH /orders/:id/payment-status` | [REST.md](./REST.md#flow-3) |
| Order placed → confirmation email | MQ `order.events / order.placed` | [MESSAGE_QUEUE.md](./MESSAGE_QUEUE.md#flow-1) |
| Order placed → warehouse inventory sync | MQ `order.events / order.placed` | [MESSAGE_QUEUE.md](./MESSAGE_QUEUE.md#flow-1) |
| Order placed → analytics event | MQ `order.events / order.placed` | [MESSAGE_QUEUE.md](./MESSAGE_QUEUE.md#flow-1) |
| Payment succeeded → mark order paid | MQ `payment.events / payment.succeeded` | [MESSAGE_QUEUE.md](./MESSAGE_QUEUE.md#flow-2) |
| Order cancelled → cancellation email | MQ `order.events / order.cancelled` | [MESSAGE_QUEUE.md](./MESSAGE_QUEUE.md#flow-3) |

---

## Infrastructure dependencies

| Component | Used by | Already in docker-compose? |
|---|---|---|
| PostgreSQL | All services (Prisma) | ✅ Yes (`db` service) |
| Redis | Sessions, BullMQ queues | ✅ Yes (`redis` service, port 6380) |
| gRPC server | Product Service | ⬜ Add port `50051` to product container |

To expose the gRPC port add to `docker-compose.yml`:

```yaml
services:
  app:
    ports:
      - "3000:3000"   # HTTP
      - "50051:50051" # gRPC
    environment:
      GRPC_PORT: 50051
```

---

## Further reading

- [REST communication flows](./REST.md)
- [gRPC communication flows](./GRPC.md)
- [Message queue flows](./MESSAGE_QUEUE.md)
