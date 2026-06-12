/**
 * authenticateService — middleware for inbound service-to-service calls.
 *
 * Expects a JWT signed with SERVICE_JWT_SECRET in the Authorization header.
 * The token payload must contain  { type: 'service', name: '<service-name>' }.
 *
 * Usage:
 *   router.post('/products/:id/decrement-stock', authenticateService, handler);
 *
 * Generating a service token (run once, store as SERVICE_TOKEN env var):
 *   node -e "
 *     const jwt = require('jsonwebtoken');
 *     console.log(jwt.sign(
 *       { type: 'service', name: 'order-service' },
 *       process.env.SERVICE_JWT_SECRET || 'dev_service_secret',
 *       { expiresIn: '365d' }
 *     ));
 *   "
 */

const jwt = require('jsonwebtoken');
const { services } = require('../config/env');

function authenticateService(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Service token required' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, services.serviceJwtSecret);
    if (payload.type !== 'service') {
      return res.status(403).json({ error: 'Not a service token' });
    }
    // Attach caller identity so handlers/logs can see which service called
    req.callerService = payload.name || 'unknown';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired service token' });
  }
}

module.exports = authenticateService;
