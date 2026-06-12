/**
 * Session Store — Redis-backed
 *
 * Key layout:
 *   session:{sessionId}   →  JSON blob  (TTL = SESSION_TTL_SECONDS)
 *   refresh:{token}       →  userId     (TTL = SESSION_TTL_SECONDS)
 *
 * Session blob shape:
 *   { sessionId, userId, role, ip, userAgent, createdAt }
 */

const redis = require('../config/redisClient');

// 7 days — matches JWT_REFRESH_EXPIRES_IN
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SESSION_PREFIX = 'session:';
const REFRESH_PREFIX = 'refresh:';

const sessionStore = {
  // ── Sessions ──────────────────────────────────────────────────────────────

  /**
   * Persist a new session.
   * @param {string} sessionId
   * @param {{ userId, role, ip, userAgent }} data
   */
  async create(sessionId, data) {
    const payload = JSON.stringify({
      sessionId,
      userId: data.userId,
      role: data.role,
      ip: data.ip || null,
      userAgent: data.userAgent || null,
      createdAt: new Date().toISOString(),
    });
    await redis.set(`${SESSION_PREFIX}${sessionId}`, payload, 'EX', SESSION_TTL_SECONDS);
  },

  /**
   * Retrieve a session. Returns null if not found / expired.
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async get(sessionId) {
    const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Delete a session (called on logout).
   * @param {string} sessionId
   */
  async destroy(sessionId) {
    await redis.del(`${SESSION_PREFIX}${sessionId}`);
  },

  /**
   * Reset the TTL on an existing session (called on token refresh).
   * @param {string} sessionId
   */
  async touch(sessionId) {
    await redis.expire(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL_SECONDS);
  },

  // ── Refresh tokens ────────────────────────────────────────────────────────

  /**
   * Store a refresh token tied to a userId.
   * @param {string} token
   * @param {string} userId
   */
  async saveRefreshToken(token, userId) {
    await redis.set(`${REFRESH_PREFIX}${token}`, userId, 'EX', SESSION_TTL_SECONDS);
  },

  /**
   * Check whether a refresh token is valid (exists in Redis).
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async hasRefreshToken(token) {
    return (await redis.exists(`${REFRESH_PREFIX}${token}`)) === 1;
  },

  /**
   * Delete a refresh token (rotation or logout).
   * @param {string} token
   */
  async deleteRefreshToken(token) {
    await redis.del(`${REFRESH_PREFIX}${token}`);
  },
};

module.exports = sessionStore;
