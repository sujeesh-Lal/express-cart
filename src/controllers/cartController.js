const cartService = require('../services/cartService');

const cartController = {
  getCart(req, res, next) {
    try {
      const cart = cartService.getCart(req.user.id);
      res.json({
        id: cart.id,
        items: cart.items,
        total: cart.total,
        itemCount: cart.itemCount,
        updatedAt: cart.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  },

  addItem(req, res, next) {
    try {
      const cart = cartService.addItem(req.user.id, req.body);
      res.status(201).json({ id: cart.id, items: cart.items, total: cart.total });
    } catch (err) {
      next(err);
    }
  },

  updateItem(req, res, next) {
    try {
      const cart = cartService.updateItem(req.user.id, req.params.productId, req.body);
      res.json({ id: cart.id, items: cart.items, total: cart.total });
    } catch (err) {
      next(err);
    }
  },

  removeItem(req, res, next) {
    try {
      cartService.removeItem(req.user.id, req.params.productId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  clearCart(req, res, next) {
    try {
      cartService.clearCart(req.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};

module.exports = cartController;
