const Redis = require('ioredis');
const { redis: redisConfig } = require('./env');

const client = new Redis(redisConfig.url, {
  // Retry up to 3 times with a 500 ms delay before giving up
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null; // stop retrying — let the error bubble up
    return Math.min(times * 500, 2000);
  },
  lazyConnect: false,
});

client.on('connect', () => console.info('[Redis] connected'));
client.on('error', (err) => console.error('[Redis] error:', err.message));

module.exports = client;
