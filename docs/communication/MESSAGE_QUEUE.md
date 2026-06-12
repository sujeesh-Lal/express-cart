# Service-to-Service Communication — Message Queues

Message queues decouple the **producer** (the service that triggers work) from the **consumer** (the service that does the work). The producer fires and forgets — it doesn't wait for the consumer to finish. This is ideal for operations that are slow, optional, or need to survive restarts (emails, analytics, inventory sync).

This project uses **BullMQ** over the Redis instance already running for sessions — no extra infrastructure needed.

---

## Architecture

```
                          Redis (BullMQ broker)
                         ┌───────────────────────────────────────┐
                         │  Queue: order.events                  │
                         │  Queue: payment.events                │
                         │  Queue: notification.events           │
                         └───────────────────────────────────────┘
                               ▲               │
            publish job        │               │  consume job
                               │               ▼
┌──────────────────┐     ┌─────┴──────┐   ┌───────────────────┐
│  Order Service   │────►│  BullMQ    │   │ Inventory Worker  │
│  (Producer)      │     │  Queues    │   │ Notification Wrkr │
└──────────────────┘     └─────┬──────┘   │ Analytics Worker  │
                               │          └───────────────────┘
┌──────────────────┐           │
│  Payment Service │───────────┘
│  (Producer)      │
└──────────────────┘
```

---

## Queues & Events

| Queue | Published by | Consumed by | Trigger |
|---|---|---|---|
| `order.events` | Order Service | Inventory Worker, Notification Worker, Analytics Worker | Checkout, cancel |
| `payment.events` | Payment Service | Order Service Worker, Notification Worker | Payment succeeded/failed |
| `notification.events` | Any service | Notification Worker | Anything that sends email/SMS |

---

## Setup

```bash
npm install bullmq
```

```env
REDIS_URL=redis://localhost:6379   # already set for sessions
```

---

## Queue configuration

```js
// src/queues/index.js
const { Queue } = require('bullmq');
const redis = require('../config/redisClient');

const connection = { host: redis.options.host, port: redis.options.port };

const orderQueue        = new Queue('order.events',        { connection });
const paymentQueue      = new Queue('payment.events',      { connection });
const notificationQueue = new Queue('notification.events', { connection });

module.exports = { orderQueue, paymentQueue, notificationQueue };
```

---

## Flow 1 — Order placed

When a user checks out, the Order Service publishes an `order.placed` job. Three workers consume it independently.

```
Client
  │
  │  POST /orders  (checkout)
  ▼
Order Service
  │
  ├─ validate cart, decrement stock, create Order in DB  (synchronous)
  │
  ├─ orderQueue.add('order.placed', {           ← fire-and-forget
  │    orderId, userId, items, totalAmount
  │  })
  │
  └──► 201 { order }   ← client doesn't wait for workers

          │  (async, in background)
          ▼
  ┌───────────────────────────────────────────────────────┐
  │                  order.events queue                   │
  └──────┬────────────────┬──────────────────┬────────────┘
         │                │                  │
         ▼                ▼                  ▼
  Inventory Worker  Notification Worker  Analytics Worker
  (update warehouse  (send order         (track revenue,
   system / ERP)      confirmation       conversion event)
                       email)
```

### Producer — Order Service

```js
// src/services/orderService.js  (addition to checkout)
const { orderQueue } = require('../queues');

async checkout(userId) {
  // ... existing transaction logic ...

  // Publish event after successful commit
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
  }, {
    attempts: 3,                      // retry up to 3× on failure
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 }, // keep last 100 completed jobs for debugging
    removeOnFail:     { count: 50  },
  });

  return order;
}
```

### Consumer — Notification Worker

```js
// src/workers/notificationWorker.js
const { Worker } = require('bullmq');
const redis = require('../config/redisClient');

const connection = { host: redis.options.host, port: redis.options.port };

const worker = new Worker('order.events', async (job) => {
  if (job.name === 'order.placed') {
    const { orderId, userId, totalAmount, items } = job.data;

    console.info(`[NotificationWorker] Sending confirmation for order ${orderId}`);

    // Replace with your email provider (Resend, SendGrid, SES, etc.)
    await sendOrderConfirmationEmail({
      to:      await getUserEmail(userId),
      orderId,
      items,
      totalAmount,
    });
  }

  if (job.name === 'order.cancelled') {
    await sendOrderCancellationEmail(job.data);
  }
}, { connection, concurrency: 5 });

worker.on('completed', (job) =>
  console.info(`[NotificationWorker] job ${job.id} done`)
);
worker.on('failed', (job, err) =>
  console.error(`[NotificationWorker] job ${job.id} failed:`, err.message)
);

module.exports = worker;
```

### Consumer — Inventory Worker

```js
// src/workers/inventoryWorker.js
const { Worker } = require('bullmq');
const redis = require('../config/redisClient');

const connection = { host: redis.options.host, port: redis.options.port };

const worker = new Worker('order.events', async (job) => {
  if (job.name === 'order.placed') {
    const { orderId, items } = job.data;
    // Sync to external warehouse / ERP system
    for (const item of items) {
      await warehouseClient.decrementStock(item.productId, item.quantity);
    }
    console.info(`[InventoryWorker] Warehouse updated for order ${orderId}`);
  }

  if (job.name === 'order.cancelled') {
    // Restore stock in warehouse
    for (const item of job.data.items) {
      await warehouseClient.incrementStock(item.productId, item.quantity);
    }
  }
}, { connection, concurrency: 2 });

module.exports = worker;
```

---

## Flow 2 — Payment completed

Stripe sends a webhook → Payment Service verifies it → publishes `payment.succeeded` → Order Service worker updates order status → Notification Worker sends receipt email.

```
Stripe
  │
  │  POST /payments/webhook
  ▼
Payment Service
  │
  ├─ verify Stripe signature
  ├─ extract paymentIntentId
  │
  ├─ paymentQueue.add('payment.succeeded', {    ← fire-and-forget
  │    paymentIntentId, amount, currency
  │  })
  │
  └──► 200 { received: true }  →  Stripe (must respond in < 30 s)

          │  (async)
          ▼
  ┌───────────────────────────────┐
  │      payment.events queue    │
  └───────┬───────────────────────┘
          │
  ┌───────┼────────────────────┐
  │       │                    │
  ▼       ▼                    ▼
Order   Notification        Analytics
Worker  Worker              Worker
(set    (send receipt       (record
status  email)              revenue)
→ paid)
```

### Producer — Payment Service

```js
// src/services/paymentService.js  (webhook handler)
const { paymentQueue } = require('../queues');

async handleWebhook(rawBody, signature) {
  const event = stripe.webhooks.constructEvent(
    rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === 'payment_intent.succeeded') {
    await paymentQueue.add('payment.succeeded', {
      paymentIntentId: event.data.object.id,
      amount:          event.data.object.amount,
      currency:        event.data.object.currency,
      succeededAt:     new Date().toISOString(),
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  if (event.type === 'payment_intent.payment_failed') {
    await paymentQueue.add('payment.failed', {
      paymentIntentId: event.data.object.id,
      failureMessage:  event.data.object.last_payment_error?.message,
    });
  }

  return { received: true };
}
```

### Consumer — Order Worker

```js
// src/workers/orderWorker.js
const { Worker } = require('bullmq');
const orderRepository = require('../repositories/orderRepository');
const redis = require('../config/redisClient');

const connection = { host: redis.options.host, port: redis.options.port };

const worker = new Worker('payment.events', async (job) => {
  if (job.name === 'payment.succeeded') {
    const { paymentIntentId } = job.data;
    const orders = await orderRepository.findAll();
    const order  = orders.find(o => o.paymentIntentId === paymentIntentId);

    if (order) {
      await orderRepository.update(order.id, {
        paymentStatus: 'paid',
        status:        'processing',
      });
      console.info(`[OrderWorker] Order ${order.id} marked as paid`);
    }
  }

  if (job.name === 'payment.failed') {
    const { paymentIntentId, failureMessage } = job.data;
    const orders = await orderRepository.findAll();
    const order  = orders.find(o => o.paymentIntentId === paymentIntentId);
    if (order) {
      await orderRepository.update(order.id, { paymentStatus: 'unpaid' });
      // Optionally notify user
    }
  }
}, { connection });

module.exports = worker;
```

---

## Flow 3 — Order cancelled

```
Client
  │
  │  DELETE /orders/:id/cancel
  ▼
Order Service
  │
  ├─ update order status → CANCELLED  (synchronous DB write)
  │
  └─ orderQueue.add('order.cancelled', { orderId, userId, items })

          │  (async)
          ▼
  Inventory Worker    →  restore stock in warehouse
  Notification Worker →  send cancellation email
```

---

## Job Retry & Dead-Letter

BullMQ retries failed jobs automatically according to the `attempts` + `backoff` config. After all retries are exhausted, jobs move to the **failed** set — your dead-letter queue.

```js
// Monitor failed jobs
const { QueueEvents } = require('bullmq');
const events = new QueueEvents('order.events', { connection });

events.on('failed', ({ jobId, failedReason }) => {
  console.error(`[DLQ] Job ${jobId} exhausted retries: ${failedReason}`);
  // Alert PagerDuty / Slack / etc.
});
```

### Retry timeline (exponential back-off, delay = 2000 ms)

| Attempt | Delay before retry |
|---|---|
| 1st retry | 2 s |
| 2nd retry | 4 s |
| 3rd retry | 8 s |
| → failed set | — (alert ops) |

---

## Idempotency

Workers must be idempotent — the same job may be delivered more than once (at-least-once delivery). Guard with a processed-job cache:

```js
// At the top of your worker processor:
async function processOrderPlaced(job) {
  const alreadyProcessed = await redis.exists(`processed:${job.id}`);
  if (alreadyProcessed) return; // duplicate — skip

  // ... do the work ...

  await redis.set(`processed:${job.id}`, '1', 'EX', 86400); // TTL 24 h
}
```

---

## Starting Workers

```js
// src/app.js — start workers when the server boots
require('./workers/notificationWorker');
require('./workers/inventoryWorker');
require('./workers/orderWorker');
```

Or run them as separate processes for independent scaling:

```bash
node src/workers/notificationWorker.js
node src/workers/inventoryWorker.js
```

---

## When to use Message Queues

- Work that can happen **after** the HTTP response is sent (emails, analytics, webhooks)
- Operations that are **slow** or call **external third-party APIs**
- Work that must **survive process restarts** (critical side-effects)
- Fan-out to **multiple consumers** from a single event (inventory + notification + analytics all from one `order.placed`)
- Absorbing **traffic spikes** — queue buffers load, workers process at their own pace

> For operations that need an **immediate answer**, use [REST](./REST.md) or [gRPC](./GRPC.md).
