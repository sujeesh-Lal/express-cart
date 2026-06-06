const prisma = require('../config/prismaClient');

/** Include order items on every order query. */
const ORDER_INCLUDE = { items: true };

const orderRepository = {
  async findAll() {
    return prisma.order.findMany({ include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' } });
  },

  async findByUserId(userId) {
    return prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  },

  async findById(id) {
    return prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  },

  /**
   * Create an order together with its items in a single query.
   * `items` should be an array of: { productId, name, quantity, priceAtTime }
   */
  async create({ userId, items, totalAmount, status, paymentStatus }) {
    return prisma.order.create({
      data: {
        userId,
        totalAmount,
        status,
        paymentStatus,
        items: { create: items },
      },
      include: ORDER_INCLUDE,
    });
  },

  async update(id, fields) {
    return prisma.order.update({ where: { id }, data: fields, include: ORDER_INCLUDE });
  },
};

module.exports = orderRepository;
