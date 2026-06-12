const prisma = require('../config/prismaClient');
const orderRepository = require('../repositories/orderRepository');
const cartRepository = require('../repositories/cartRepository');
const productClient = require('../clients/productClient');
const { services } = require('../config/env');

const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

const PAYMENT_STATUS = {
  UNPAID: 'unpaid',
  PAID: 'paid',
  REFUNDED: 'refunded',
};

const orderService = {
  /**
   * Checkout — converts the user's cart into an order.
   *
   * MONOLITH MODE  (PRODUCT_SERVICE_URL not set):
   *   Runs entirely inside a Prisma transaction — stock decrements, order
   *   creation, and cart clearing are all-or-nothing.
   *
   * MICROSERVICE MODE  (PRODUCT_SERVICE_URL is set):
   *   1. Validate stock via REST calls to Product Service.
   *   2. Decrement stock via REST calls to Product Service.
   *   3. Create order in local DB.
   *   4. If order creation fails → call releaseStock on each decremented
   *      product (compensating transaction).
   */
  async checkout(userId) {
    const cart = await cartRepository.findByUserId(userId);
    if (!cart || cart.items.length === 0) {
      throw Object.assign(new Error('Cart is empty'), { status: 400 });
    }

    if (services.productServiceUrl) {
      return orderService._checkoutViaRest(userId, cart);
    }
    return orderService._checkoutLocal(userId, cart);
  },

  /** Monolith checkout — single Prisma transaction. */
  async _checkoutLocal(userId, cart) {
    const order = await prisma.$transaction(async (tx) => {
      const orderItems = [];

      for (const item of cart.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) {
          throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 400 });
        }
        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}"`),
            { status: 400 }
          );
        }
        orderItems.push({
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          priceAtTime: item.priceAtTime,
        });
      }

      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const totalAmount = +orderItems
        .reduce((sum, i) => sum + i.priceAtTime * i.quantity, 0)
        .toFixed(2);

      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          status: ORDER_STATUS.PENDING,
          paymentStatus: PAYMENT_STATUS.UNPAID,
          items: { create: orderItems },
        },
        include: { items: true },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return newOrder;
    });

    return order;
  },

  /**
   * Microservice checkout — REST calls to Product Service.
   * Uses a compensating transaction pattern to restore stock on failure.
   */
  async _checkoutViaRest(userId, cart) {
    const orderItems = [];

    // ── Step 1: validate stock via GET /products/:id ──────────────────────
    for (const item of cart.items) {
      const product = await productClient.getProduct(item.productId);
      if (!product) {
        throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 400 });
      }
      if (product.stock < item.quantity) {
        throw Object.assign(
          new Error(`Insufficient stock for "${product.name}"`),
          { status: 400 }
        );
      }
      orderItems.push({
        productId: product.id,
        name:      product.name,
        quantity:  item.quantity,
        priceAtTime: item.priceAtTime,
      });
    }

    // ── Step 2: decrement stock via POST /products/:id/decrement-stock ────
    const decremented = [];
    try {
      for (const item of orderItems) {
        await productClient.decrementStock(item.productId, item.quantity);
        decremented.push(item); // track for rollback
      }
    } catch (err) {
      // Compensate — restore stock for items already decremented
      console.error('[orderService] Stock decrement failed — releasing reserved stock');
      await Promise.allSettled(
        decremented.map(i => productClient.releaseStock(i.productId, i.quantity))
      );
      throw err;
    }

    // ── Step 3: create order in local DB ──────────────────────────────────
    let order;
    try {
      const totalAmount = +orderItems
        .reduce((sum, i) => sum + i.priceAtTime * i.quantity, 0)
        .toFixed(2);

      order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            userId,
            totalAmount,
            status: ORDER_STATUS.PENDING,
            paymentStatus: PAYMENT_STATUS.UNPAID,
            items: { create: orderItems },
          },
          include: { items: true },
        });
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        return newOrder;
      });
    } catch (err) {
      // Order DB write failed — release all decremented stock
      console.error('[orderService] Order creation failed — releasing reserved stock');
      await Promise.allSettled(
        orderItems.map(i => productClient.releaseStock(i.productId, i.quantity))
      );
      throw err;
    }

    return order;
  },

  async getMyOrders(userId) {
    return orderRepository.findByUserId(userId);
  },

  async getOrder(id, userId, role) {
    const order = await orderRepository.findById(id);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (role !== 'admin' && order.userId !== userId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return order;
  },

  async cancelOrder(id, userId, role) {
    const order = await orderService.getOrder(id, userId, role);
    if ([ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED].includes(order.status)) {
      throw Object.assign(
        new Error('Cannot cancel an order that has been shipped or delivered'),
        { status: 400 }
      );
    }
    return orderRepository.update(id, { status: ORDER_STATUS.CANCELLED });
  },

  async getAllOrders() {
    return orderRepository.findAll();
  },

  async updateOrderStatus(id, { status }) {
    const order = await orderRepository.findById(id);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    return orderRepository.update(id, { status });
  },
};

module.exports = orderService;
