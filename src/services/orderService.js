const orderRepository = require('../repositories/orderRepository');
const cartRepository = require('../repositories/cartRepository');
const productRepository = require('../repositories/productRepository');
const { ORDER_STATUS, PAYMENT_STATUS } = require('../models/Order');

const orderService = {
  checkout(userId) {
    const cart = cartRepository.findByUserId(userId);
    if (!cart || cart.items.length === 0) {
      throw Object.assign(new Error('Cart is empty'), { status: 400 });
    }

    // Validate stock and build order item snapshot
    const orderItems = cart.items.map((item) => {
      const product = productRepository.findById(item.productId);
      if (!product) throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 400 });
      if (product.stock < item.quantity) {
        throw Object.assign(new Error(`Insufficient stock for "${product.name}"`), { status: 400 });
      }
      return {
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        priceAtTime: item.priceAtTime,
      };
    });

    // Deduct stock
    orderItems.forEach((item) => {
      productRepository.decrementStock(item.productId, item.quantity);
    });

    const totalAmount = +orderItems
      .reduce((sum, i) => sum + i.priceAtTime * i.quantity, 0)
      .toFixed(2);

    const order = orderRepository.create({
      userId,
      items: orderItems,
      totalAmount,
      status: ORDER_STATUS.PENDING,
      paymentStatus: PAYMENT_STATUS.UNPAID,
    });

    // Clear cart after checkout
    cartRepository.clear(userId);

    return order;
  },

  getMyOrders(userId) {
    return orderRepository.findByUserId(userId);
  },

  getOrder(id, userId, role) {
    const order = orderRepository.findById(id);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (role !== 'admin' && order.userId !== userId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return order;
  },

  cancelOrder(id, userId, role) {
    const order = orderService.getOrder(id, userId, role);
    if ([ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED].includes(order.status)) {
      throw Object.assign(new Error('Cannot cancel an order that has been shipped or delivered'), { status: 400 });
    }
    return orderRepository.update(id, { status: ORDER_STATUS.CANCELLED });
  },

  getAllOrders() {
    return orderRepository.findAll();
  },

  updateOrderStatus(id, { status }) {
    const order = orderRepository.findById(id);
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    return orderRepository.update(id, { status });
  },
};

module.exports = orderService;
