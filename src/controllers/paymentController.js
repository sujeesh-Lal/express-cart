const paymentService = require('../services/paymentService');

const paymentController = {
  async createCheckout(req, res, next) {
    try {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId required' });
      const intent = await paymentService.createCheckout(req.user.id, orderId);
      res.json(intent);
    } catch (err) {
      next(err);
    }
  },

  async handleWebhook(req, res, next) {
    try {
      const result = await paymentService.handleWebhook(
        req.body,
        req.headers['stripe-signature']
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  getPaymentStatus(req, res, next) {
    try {
      const status = paymentService.getPaymentStatus(
        req.params.orderId,
        req.user.id,
        req.user.role
      );
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = paymentController;
