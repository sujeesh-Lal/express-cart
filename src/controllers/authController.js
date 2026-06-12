const authService = require('../services/authService');

const authController = {
  async register(req, res, next) {
    try {
      const user = await authService.register(req.body);
      res.status(201).json({ message: 'User registered', user });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const meta = {
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
      };
      const { accessToken, refreshToken, sessionId, user } =
        await authService.login(req.body, meta);
      res.json({ accessToken, refreshToken, sessionId, user });
    } catch (err) {
      next(err);
    }
  },

  async logout(req, res, next) {
    try {
      const { refreshToken, sessionId } = req.body;
      await authService.logout(refreshToken, sessionId);
      res.json({ message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  },

  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
      const tokens = await authService.refreshAccessToken(refreshToken);
      res.json(tokens);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = authController;
