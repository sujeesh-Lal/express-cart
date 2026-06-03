/**
 * In-memory order store.
 */
const { v4: uuidv4 } = require('uuid');
const { Order } = require('../models/Order');

const orders = [];

const orderRepository = {
  findAll() {
    return [...orders];
  },

  findByUserId(userId) {
    return orders.filter((o) => o.userId === userId);
  },

  findById(id) {
    return orders.find((o) => o.id === id) || null;
  },

  create(fields) {
    const order = new Order({ id: uuidv4(), ...fields });
    orders.push(order);
    return order;
  },

  update(id, fields) {
    const order = orders.find((o) => o.id === id);
    if (!order) return null;
    Object.assign(order, fields);
    return order;
  },
};

module.exports = orderRepository;
