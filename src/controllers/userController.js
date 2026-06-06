const userService = require('../services/userService');

const userController = {
  async getMe(req, res, next) {
    try {
      const user = await userService.getMe(req.user.id);
      res.json(user);
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req, res, next) {
    try {
      const user = await userService.updateMe(req.user.id, req.body);
      res.json(user);
    } catch (err) {
      next(err);
    }
  },

  async deleteMe(req, res, next) {
    try {
      await userService.deleteMe(req.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Admin
  async getAllUsers(req, res, next) {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (err) {
      next(err);
    }
  },

  async deleteUser(req, res, next) {
    try {
      await userService.deleteUser(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};

module.exports = userController;
