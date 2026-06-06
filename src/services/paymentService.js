/**
 * Payment service — Stripe integration stubbed out.
 * Replace mock blocks with real Stripe SDK calls when ready.
 */
const orderRepository = require('../repositories/orderRepository');

const PAYMENT_STATUS = {
  UNPAID: 'unpaid',
  PAID: 'paid',
  REFUNDED: 'refunded',
};

const paymentService = {
  /**
   * Create a Stripe Payment Intent for an order.
   * TODO: Replace mock with:
   *   const stripe = require('stripe')(config.stripe.secretKey);
   *   return stripe.paymentIntents.create({ amount, currency: 'usd', metadata: { orderId } });
   */
  async createCheckout(userId, orderId) {
    const order = await orderRepository.findById(orderId);
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

    await orderRepository.update(orderId, { paymentIntentId: mockPaymentIntent.id });

    return mockPaymentIntent;
  },

  /**
   * Handle Stripe webhook events.
   * TODO: Replace mock with:
   *   const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
   *   then switch on event.type.
   *
   * NOTE: This route must receive the raw request body (not JSON-parsed).
   * Mount paymentRoutes before express.json() and use express.raw() for the webhook path.
   */
  async handleWebhook(rawBody, signature) {
    // MOCK: Simulate a payment_intent.succeeded event
    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_mock_webhook' } },
    };

    if (mockEvent.type === 'payment_intent.succeeded') {
      const paymentIntentId = mockEvent.data.object.id;
      const orders = await orderRepository.findAll();
      const order = orders.find((o) => o.paymentIntentId === paymentIntentId);
      if (order) {
        await orderRepository.update(order.id, {
          paymentStatus: PAYMENT_STATUS.PAID,
          status: 'processing',
        });
      }
    }

    return { received: true };
  },

  async getPaymentStatus(orderId, userId, role) {
    const order = await orderRepository.findById(orderId);
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
