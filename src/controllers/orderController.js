const orderService = require('../services/orderService');

const orderController = {
  checkout(req, res, next) {
    try {
      const order = orderService.checkout(req.user.id);
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  },

  getMyOrders(req, res, next) {
    try {
      const orders = orderService.getMyOrders(req.user.id);
      res.json(orders);
    } catch (err) {
      next(err);
    }
  },

  getOrder(req, res, next) {
    try {
      const order = orderService.getOrder(req.params.id, req.user.id, req.user.role);
      res.json(order);
    } catch (err) {
      next(err);
    }
  },

  cancelOrder(req, res, next) {
    try {
      const order = orderService.cancelOrder(req.params.id, req.user.id, req.user.role);
      res.json(order);
    } catch (err) {
      next(err);
    }
  },

  // Admin
  getAllOrders(req, res, next) {
    try {
      const orders = orderService.getAllOrders();
      res.json(orders);
    } catch (err) {
      next(err);
    }
  },

  updateOrderStatus(req, res, next) {
    try {
      const order = orderService.updateOrderStatus(req.params.id, req.body);
      res.json(order);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = orderController;
