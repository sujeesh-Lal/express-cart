const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/env');
const userRepository = require('../repositories/userRepository');

// In-memory refresh token store (replace with DB/Redis later)
const refreshTokens = new Set();

const authService = {
  async register({ name, email, password }) {
    const existing = userRepository.findByEmail(email);
    if (existing) throw Object.assign(new Error('Email already in use'), { status: 409 });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = userRepository.create({ name, email, passwordHash });
    return user;
  },

  async login({ email, password }) {
    const user = userRepository.findByEmail(email);
    if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    const accessToken = authService.signAccessToken(user);
    const refreshToken = authService.signRefreshToken(user);
    refreshTokens.add(refreshToken);

    return { accessToken, refreshToken, user };
  },

  logout(refreshToken) {
    refreshTokens.delete(refreshToken);
  },

  refreshAccessToken(refreshToken) {
    if (!refreshTokens.has(refreshToken)) {
      throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, jwtConfig.refreshSecret);
    } catch {
      refreshTokens.delete(refreshToken);
      throw Object.assign(new Error('Refresh token expired'), { status: 401 });
    }

    const user = userRepository.findById(payload.sub);
    if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

    // Rotate refresh token
    refreshTokens.delete(refreshToken);
    const newRefreshToken = authService.signRefreshToken(user);
    refreshTokens.add(newRefreshToken);

    return {
      accessToken: authService.signAccessToken(user),
      refreshToken: newRefreshToken,
    };
  },

  signAccessToken(user) {
    return jwt.sign(
      { sub: user.id, role: user.role },
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
