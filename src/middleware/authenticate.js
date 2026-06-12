const authService = require('../services/authService');
const userRepository = require('../repositories/userRepository');
const sessionStore = require('../utils/sessionStore');

/**
 * Authenticate middleware
 *
 * 1. Validates the JWT from the Authorization header.
 * 2. Extracts the sessionId (sid) embedded in the token payload.
 * 3. Confirms the session still exists in Redis — rejects if it has been
 *    deleted (logout) or has expired.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = authService.verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }

  // Validate session in Redis
  if (payload.sid) {
    const session = await sessionStore.get(payload.sid);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or logged out' });
    }
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user      = { id: user.id, role: user.role };
  req.sessionId = payload.sid || null;
  next();
}

module.exports = authenticate;
