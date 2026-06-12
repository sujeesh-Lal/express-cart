const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { jwt: jwtConfig } = require('../config/env');
const userRepository = require('../repositories/userRepository');
const sessionStore = require('../utils/sessionStore');

const authService = {
  async register({ name, email, password }) {
    const existing = await userRepository.findByEmail(email);
    if (existing) throw Object.assign(new Error('Email already in use'), { status: 409 });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await userRepository.create({ name, email, passwordHash });
    return userRepository.sanitize(user);
  },

  async login({ email, password }, meta = {}) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    // Generate a unique session ID for this login
    const sessionId = uuidv4();

    // Persist session in Redis
    await sessionStore.create(sessionId, {
      userId: user.id,
      role:   user.role,
      ip:     meta.ip,
      userAgent: meta.userAgent,
    });

    const accessToken  = authService.signAccessToken(user, sessionId);
    const refreshToken = authService.signRefreshToken(user);

    // Store refresh token in Redis (replaces the in-memory Set)
    await sessionStore.saveRefreshToken(refreshToken, user.id);

    return {
      accessToken,
      refreshToken,
      sessionId,
      user: userRepository.sanitize(user),
    };
  },

  async logout(refreshToken, sessionId) {
    await Promise.all([
      refreshToken ? sessionStore.deleteRefreshToken(refreshToken) : Promise.resolve(),
      sessionId    ? sessionStore.destroy(sessionId)               : Promise.resolve(),
    ]);
  },

  async refreshAccessToken(refreshToken) {
    const exists = await sessionStore.hasRefreshToken(refreshToken);
    if (!exists) throw Object.assign(new Error('Invalid refresh token'), { status: 401 });

    let payload;
    try {
      payload = jwt.verify(refreshToken, jwtConfig.refreshSecret);
    } catch {
      await sessionStore.deleteRefreshToken(refreshToken);
      throw Object.assign(new Error('Refresh token expired'), { status: 401 });
    }

    const user = await userRepository.findById(payload.sub);
    if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

    // Rotate refresh token
    await sessionStore.deleteRefreshToken(refreshToken);
    const newRefreshToken = authService.signRefreshToken(user);
    await sessionStore.saveRefreshToken(newRefreshToken, user.id);

    // Extend the session TTL if a sessionId is embedded in the old token
    if (payload.sid) {
      await sessionStore.touch(payload.sid);
    }

    return {
      accessToken:  authService.signAccessToken(user, payload.sid),
      refreshToken: newRefreshToken,
    };
  },

  /**
   * Signs an access token.
   * Embeds sessionId (sid) so the authenticate middleware can validate it.
   */
  signAccessToken(user, sessionId) {
    return jwt.sign(
      { sub: user.id, role: user.role, sid: sessionId },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );
  },

  signRefreshToken(user) {
    return jwt.sign(
      { sub: user.id },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshExpiresIn }
    );
  },

  verifyAccessToken(token) {
    return jwt.verify(token, jwtConfig.secret);
  },
};

module.exports = authService;
