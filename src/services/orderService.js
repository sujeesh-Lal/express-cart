const prisma = require('../config/prismaClient');
const orderRepository = require('../repositories/orderRepository');
const cartRepository = require('../repositories/cartRepository');

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
   * Runs inside a Prisma transaction so that stock decrements,
   * order creation, and cart clearing are all-or-nothing.
   */
  async checkout(userId) {
    const cart = await cartRepository.findByUserId(userId);
    if (!cart || cart.items.length === 0) {
      throw Object.assign(new Error('Cart is empty'), { status: 400 });
    }

    const order = await prisma.$transaction(async (tx) => {
      const orderItems = [];

      // Validate stock and build order item snapshot inside the transaction
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

      // Decrement stock for every product
      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const totalAmount = +orderItems
        .reduce((sum, i) => sum + i.priceAtTime * i.quantity, 0)
        .toFixed(2);

      // Create order + order items in one nested write
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

      // Clear cart items
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

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
