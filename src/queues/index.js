/**
 * BullMQ queue definitions — one module, all queues.
 *
 * Queues use the same Redis instance already running for sessions,
 * so no extra infrastructure is needed.
 *
 * Queue         | Published by     | Consumed by
 * ------------- | ---------------- | ----------------------------------
 * order.events  | orderService     | inventoryWorker, notificationWorker,
 *               |                  | analyticsWorker
 * payment.events| paymentService   | orderWorker, notificationWorker
 *
 * Job options applied to every queue:
 *   - attempts:        3   (retry up to 3 times on failure)
 *   - backoff:         exponential, base 2 s
 *   - removeOnComplete keep last 100 (useful for debugging)
 *   - removeOnFail     keep last 50
 */

const { Queue } = require('bullmq');
const { redis: redisConfig } = require('../config/env');

// BullMQ needs host/port individually (not a URL string)
function redisConnection() {
  const url = new URL(redisConfig.url);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
  };
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff:  { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50  },
};

const connection = redisConnection();

const orderQueue        = new Queue('order.events',        { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const paymentQueue      = new Queue('payment.events',      { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const notificationQueue = new Queue('notification.events', { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

module.exports = { orderQueue, paymentQueue, notificationQueue, connection };
