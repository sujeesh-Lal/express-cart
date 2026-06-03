const userService = require('../services/userService');

const userController = {
  getMe(req, res, next) {
    try {
      const user = userService.getMe(req.user.id);
      res.json(user.toJSON());
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req, res, next) {
    try {
      const user = await userService.updateMe(req.user.id, req.body);
      res.json(user.toJSON());
    } catch (err) {
      next(err);
    }
  },

  deleteMe(req, res, next) {
    try {
      userService.deleteMe(req.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Admin
  getAllUsers(req, res, next) {
    try {
      const users = userService.getAllUsers().map((u) => u.toJSON());
      res.json(users);
    } catch (err) {
      next(err);
    }
  },

  deleteUser(req, res, next) {
    try {
      userService.deleteUser(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};

module.exports = userController;
