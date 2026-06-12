/**
 * Order Worker
 *
 * Consumes:  payment.events → payment.succeeded, payment.failed
 *
 * Updates the Order record in the database when Stripe confirms
 * (or rejects) a payment.
 */

const { Worker, QueueEvents } = require('bullmq');
const { connection } = require('../queues');
const { withIdempotency } = require('../utils/idempotency');
const orderRepository = require('../repositories/orderRepository');

const worker = new Worker(
  'payment.events',
  withIdempotency(async (job) => {
    if (job.name === 'payment.succeeded') {
      const { paymentIntentId, orderId } = job.data;

      // If orderId is provided directly, use it; otherwise look up by paymentIntentId
      let targetOrderId = orderId;
      if (!targetOrderId) {
        const orders = await orderRepository.findAll();
        const order  = orders.find((o) => o.paymentIntentId === paymentIntentId);
        if (!order) {
          console.warn(`[orderWorker] no order found for paymentIntentId ${paymentIntentId}`);
          return;
        }
        targetOrderId = order.id;
      }

      await orderRepository.update(targetOrderId, {
        paymentStatus: 'paid',
        status:        'processing',
      });
      console.info(`[orderWorker] ✓ order ${targetOrderId} marked as paid → processing`);
      return;
    }

    if (job.name === 'payment.failed') {
      const { paymentIntentId, orderId, failureMessage } = job.data;

      let targetOrderId = orderId;
      if (!targetOrderId) {
        const orders = await orderRepository.findAll();
        const order  = orders.find((o) => o.paymentIntentId === paymentIntentId);
        if (!order) return;
        targetOrderId = order.id;
      }

      await orderRepository.update(targetOrderId, { paymentStatus: 'unpaid' });
      console.warn(`[orderWorker] payment failed for order ${targetOrderId}: ${failureMessage}`);
      return;
    }
  }),
  { connection, concurrency: 5 }
);

worker.on('completed', (job) =>
  console.info(`[orderWorker] ✓ ${job.name} #${job.id}`)
);

worker.on('failed', (job, err) =>
  console.error(`[orderWorker] ✗ ${job?.name} #${job?.id} — ${err.message}`)
);

// Dead-letter monitoring
const queueEvents = new QueueEvents('payment.events', { connection });
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[DLQ:orderWorker] job ${jobId} exhausted retries: ${failedReason}`);
  // TODO: alert ops — order payment status may be stale
});

module.exports = worker;
