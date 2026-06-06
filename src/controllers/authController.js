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
      const { accessToken, refreshToken, user } = await authService.login(req.body);
      res.json({ accessToken, refreshToken, user });
    } catch (err) {
      next(err);
    }
  },

  logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      authService.logout(refreshToken);
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
