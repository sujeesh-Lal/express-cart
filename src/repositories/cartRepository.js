/**
 * In-memory cart store — one cart per user.
 */
const { v4: uuidv4 } = require('uuid');
const Cart = require('../models/Cart');
const CartItem = require('../models/CartItem');

// Map: userId → Cart
const carts = new Map();

const cartRepository = {
  findByUserId(userId) {
    return carts.get(userId) || null;
  },

  getOrCreate(userId) {
    if (!carts.has(userId)) {
      carts.set(userId, new Cart({ id: uuidv4(), userId, items: [] }));
    }
    return carts.get(userId);
  },

  save(cart) {
    cart.updatedAt = new Date();
    carts.set(cart.userId, cart);
    return cart;
  },

  clear(userId) {
    const cart = carts.get(userId);
    if (cart) {
      cart.items = [];
      cart.updatedAt = new Date();
    }
    return cart || null;
  },
};

module.exports = cartRepository;
