/**
 * Analytics Worker
 *
 * Consumes:  order.events → order.placed, order.cancelled
 *
 * Tracks revenue and conversion events.
 * Replace the `analyticsClient` stub with your real provider
 * (Segment, Mixpanel, Amplitude, custom data warehouse, etc.).
 */

const { Worker, QueueEvents } = require('bullmq');
const { connection } = require('../queues');
const { withIdempotency } = require('../utils/idempotency');

// ── Analytics client stub ─────────────────────────────────────────────────────

const analyticsClient = {
  async track(event, properties) {
    // TODO: call real analytics provider (Segment, Mixpanel, etc.)
    console.info(`[analytics] track "${event}"`, JSON.stringify(properties));
  },
};

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(
  'order.events',
  withIdempotency(async (job) => {
    if (job.name === 'order.placed') {
      const { orderId, userId, totalAmount, items, placedAt } = job.data;
      await analyticsClient.track('Order Placed', {
        orderId,
        userId,
        totalAmount,
        itemCount: items.reduce((n, i) => n + i.quantity, 0),
        revenue:   totalAmount,
        placedAt,
      });
      return;
    }

    if (job.name === 'order.cancelled') {
      const { orderId, userId, totalAmount } = job.data;
      await analyticsClient.track('Order Cancelled', {
        orderId,
        userId,
        revenue: -(totalAmount || 0), // negative revenue for cancellations
      });
      return;
    }
  }),
  { connection, concurrency: 20 } // analytics is fire-and-forget, can be high
);

worker.on('completed', (job) =>
  console.info(`[analyticsWorker] ✓ ${job.name} #${job.id}`)
);

worker.on('failed', (job, err) =>
  console.error(`[analyticsWorker] ✗ ${job?.name} #${job?.id} — ${err.message}`)
);

const queueEvents = new QueueEvents('order.events', { connection });
queueEvents.on('failed', ({ jobId, failedReason }) => {
  // Analytics failures are low-severity — log but don't page
  console.warn(`[DLQ:analyticsWorker] job ${jobId} failed: ${failedReason}`);
});

module.exports = worker;
