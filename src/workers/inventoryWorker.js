/**
 * Inventory Worker
 *
 * Consumes:  order.events → order.placed, order.cancelled
 *
 * Syncs stock changes to an external warehouse / ERP system.
 * Replace the `warehouseClient` stub with your real integration.
 */

const { Worker, QueueEvents } = require('bullmq');
const { connection } = require('../queues');
const { withIdempotency } = require('../utils/idempotency');

// ── Warehouse client stub — replace with real ERP / WMS API ──────────────────

const warehouseClient = {
  async decrementStock(productId, quantity) {
    // TODO: call real warehouse API (SAP, NetSuite, ShipBob, etc.)
    console.info(`[warehouse] decrement product=${productId} qty=${quantity}`);
  },
  async incrementStock(productId, quantity) {
    console.info(`[warehouse] increment product=${productId} qty=${quantity}`);
  },
};

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(
  'order.events',
  withIdempotency(async (job) => {
    const { orderId, items } = job.data;

    if (job.name === 'order.placed') {
      console.info(`[inventoryWorker] syncing stock decrement for order ${orderId}`);
      for (const item of items) {
        await warehouseClient.decrementStock(item.productId, item.quantity);
      }
      return;
    }

    if (job.name === 'order.cancelled') {
      console.info(`[inventoryWorker] restoring stock for cancelled order ${orderId}`);
      for (const item of items) {
        await warehouseClient.incrementStock(item.productId, item.quantity);
      }
      return;
    }

    // Unknown job names are silently skipped
  }),
  { connection, concurrency: 2 } // keep low — warehouse APIs are often rate-limited
);

worker.on('completed', (job) =>
  console.info(`[inventoryWorker] ✓ ${job.name} #${job.id}`)
);

worker.on('failed', (job, err) =>
  console.error(`[inventoryWorker] ✗ ${job?.name} #${job?.id} — ${err.message}`)
);

// Dead-letter monitoring
const queueEvents = new QueueEvents('order.events', { connection });
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[DLQ:inventoryWorker] job ${jobId} exhausted retries: ${failedReason}`);
  // TODO: alert ops — stock may be out of sync
});

module.exports = worker;
