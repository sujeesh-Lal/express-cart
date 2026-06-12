/**
 * Notification Worker
 *
 * Consumes:  order.events   → order.placed, order.cancelled
 *            payment.events → payment.succeeded, payment.failed
 *
 * Sends transactional emails for each event.
 * Replace the `sendEmail` stub with your real provider
 * (Resend, SendGrid, AWS SES, etc.).
 */

const { Worker, QueueEvents } = require('bullmq');
const { connection } = require('../queues');
const { withIdempotency } = require('../utils/idempotency');

// ── Email stub — replace with real provider ───────────────────────────────────

async function sendEmail({ to, subject, body }) {
  // TODO: integrate Resend / SendGrid / SES
  console.info(`[email] → ${to} | ${subject}`);
  console.info(`[email]   ${body.slice(0, 120)}…`);
}

// ── Job processors ────────────────────────────────────────────────────────────

const handlers = {
  // ── order.events ──────────────────────────────────────────────────────────
  'order.placed': async (job) => {
    const { orderId, userId, items, totalAmount } = job.data;
    const itemLines = items
      .map((i) => `  • ${i.name} × ${i.quantity}  $${(i.price * i.quantity).toFixed(2)}`)
      .join('\n');

    await sendEmail({
      to:      `user-${userId}@example.com`, // replace with real user lookup
      subject: `Order confirmed — #${orderId}`,
      body:    `Thanks for your order!\n\nItems:\n${itemLines}\n\nTotal: $${totalAmount}`,
    });
  },

  'order.cancelled': async (job) => {
    const { orderId, userId } = job.data;
    await sendEmail({
      to:      `user-${userId}@example.com`,
      subject: `Order cancelled — #${orderId}`,
      body:    `Your order #${orderId} has been cancelled. Any charge will be refunded within 3–5 days.`,
    });
  },

  // ── payment.events ─────────────────────────────────────────────────────────
  'payment.succeeded': async (job) => {
    const { orderId, userId, amount, currency } = job.data;
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' })
      .format((amount || 0) / 100);
    await sendEmail({
      to:      `user-${userId}@example.com`,
      subject: `Payment receipt — ${formatted}`,
      body:    `We received your payment of ${formatted} for order #${orderId}. Thank you!`,
    });
  },

  'payment.failed': async (job) => {
    const { orderId, userId, failureMessage } = job.data;
    await sendEmail({
      to:      `user-${userId}@example.com`,
      subject: `Payment failed — order #${orderId}`,
      body:    `Unfortunately your payment could not be processed: ${failureMessage}. Please retry.`,
    });
  },
};

// ── Worker factory ────────────────────────────────────────────────────────────

function createNotificationWorker(queueName) {
  const worker = new Worker(
    queueName,
    withIdempotency(async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        console.warn(`[notificationWorker:${queueName}] no handler for job "${job.name}" — skipping`);
        return;
      }
      await handler(job);
    }),
    { connection, concurrency: 10 }
  );

  worker.on('completed', (job) =>
    console.info(`[notificationWorker:${queueName}] ✓ ${job.name} #${job.id}`)
  );

  worker.on('failed', (job, err) =>
    console.error(`[notificationWorker:${queueName}] ✗ ${job?.name} #${job?.id} — ${err.message}`)
  );

  return worker;
}

// Listen on both queues
const orderEventsWorker   = createNotificationWorker('order.events');
const paymentEventsWorker = createNotificationWorker('payment.events');

// ── Dead-letter monitoring ────────────────────────────────────────────────────

const orderQueueEvents = new QueueEvents('order.events',   { connection });
const paymentQueueEvents = new QueueEvents('payment.events', { connection });

[orderQueueEvents, paymentQueueEvents].forEach((qe) => {
  qe.on('failed', ({ jobId, failedReason }) => {
    console.error(`[DLQ:notificationWorker] job ${jobId} exhausted all retries: ${failedReason}`);
    // TODO: forward to PagerDuty / Slack alert
  });
});

module.exports = { orderEventsWorker, paymentEventsWorker };
