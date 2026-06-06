const authService = require('../services/authService');
const userRepository = require('../repositories/userRepository');

/**
 * Verifies the JWT from the Authorization header and attaches req.user.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = authService.verifyAccessToken(token);
    const user = await userRepository.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

module.exports = authenticate;
