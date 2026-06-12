/**
 * Idempotency guard for BullMQ workers.
 *
 * BullMQ guarantees at-least-once delivery — the same job may be
 * processed more than once (e.g. after a worker crash mid-job).
 * Wrap every worker processor with `withIdempotency` to skip
 * duplicate executions safely.
 *
 * Usage:
 *   new Worker('order.events', withIdempotency(async (job) => {
 *     // your logic here — runs exactly once per job ID
 *   }), { connection });
 *
 * Each processed job ID is stored in Redis with a 24-hour TTL.
 */

const redis = require('../config/redisClient');

const TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * @param {(job: Job) => Promise<any>} processor
 * @returns {(job: Job) => Promise<any>}
 */
function withIdempotency(processor) {
  return async function (job) {
    const key = `processed:${job.queueName}:${job.id}`;

    const already = await redis.get(key);
    if (already) {
      console.info(`[idempotency] skipping duplicate job ${job.queueName}#${job.id}`);
      return;
    }

    const result = await processor(job);

    // Mark as processed only after successful completion
    await redis.set(key, '1', 'EX', TTL_SECONDS);
    return result;
  };
}

module.exports = { withIdempotency };
