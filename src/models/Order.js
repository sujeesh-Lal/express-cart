/**
 * Order model shape
 * {
 *   id: string,
 *   userId: string,
 *   items: [{ productId, name, quantity, priceAtTime }],  // snapshot
 *   totalAmount: number,
 *   status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled',
 *   paymentStatus: 'unpaid' | 'paid' | 'refunded',
 *   paymentIntentId: string | null,
 *   createdAt: Date,
 * }
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

class Order {
  constructor({
    id,
    userId,
    items,
    totalAmount,
    status = ORDER_STATUS.PENDING,
    paymentStatus = PAYMENT_STATUS.UNPAID,
    paymentIntentId = null,
    createdAt,
  }) {
    this.id = id;
    this.userId = userId;
    this.items = items;
    this.totalAmount = totalAmount;
    this.status = status;
    this.paymentStatus = paymentStatus;
    this.paymentIntentId = paymentIntentId;
    this.createdAt = createdAt || new Date();
  }
}

module.exports = { Order, ORDER_STATUS, PAYMENT_STATUS };
