/**
 * Payment service — Stripe integration stubbed out.
 * Replace mock responses with real Stripe SDK calls when ready.
 */
const orderRepository = require('../repositories/orderRepository');
const { PAYMENT_STATUS } = require('../models/Order');

const paymentService = {
  /**
   * Create a Stripe Payment Intent for an order.
   * TODO: Replace with `stripe.paymentIntents.create(...)` when Stripe is configured.
   */
  async createCheckout(userId, orderId) {
    const order = orderRepository.findById(orderId);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (order.userId !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 });
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      throw Object.assign(new Error('Order already paid'), { status: 400 });
    }

    // MOCK: Simulate a Stripe payment intent response
    const mockPaymentIntent = {
      id: `pi_mock_${Date.now()}`,
      client_secret: `pi_mock_secret_${Date.now()}`,
      amount: Math.round(order.totalAmount * 100), // cents
      currency: 'usd',
      status: 'requires_payment_method',
    };

    // Save the intent ID on the order
    orderRepository.update(orderId, { paymentIntentId: mockPaymentIntent.id });

    return mockPaymentIntent;
  },

  /**
   * Handle Stripe webhook events.
   * TODO: Verify signature with `stripe.webhooks.constructEvent(...)`.
   */
  async handleWebhook(rawBody, signature) {
    // MOCK: Simulate processing a payment_intent.succeeded event
    // In production: parse and verify the real Stripe event here

    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_mock_webhook', metadata: {} } },
    };

    if (mockEvent.type === 'payment_intent.succeeded') {
      const paymentIntentId = mockEvent.data.object.id;
      const orders = orderRepository.findAll();
      const order = orders.find((o) => o.paymentIntentId === paymentIntentId);
      if (order) {
        orderRepository.update(order.id, { paymentStatus: PAYMENT_STATUS.PAID, status: 'processing' });
      }
    }

    return { received: true };
  },

  getPaymentStatus(orderId, userId, role) {
    const order = orderRepository.findById(orderId);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (role !== 'admin' && order.userId !== userId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }

    return {
      orderId: order.id,
      paymentStatus: order.paymentStatus,
      paymentIntentId: order.paymentIntentId,
      totalAmount: order.totalAmount,
    };
  },
};

module.exports = paymentService;
