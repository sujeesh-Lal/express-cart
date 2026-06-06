/**
 * Order status and payment status constants.
 * These mirror the Prisma enums in schema.prisma.
 */

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

module.exports = { ORDER_STATUS, PAYMENT_STATUS };
