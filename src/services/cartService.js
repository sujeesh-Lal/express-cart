const cartRepository = require('../repositories/cartRepository');
const productRepository = require('../repositories/productRepository');
const CartItem = require('../models/CartItem');

const cartService = {
  getCart(userId) {
    return cartRepository.getOrCreate(userId);
  },

  addItem(userId, { productId, quantity = 1 }) {
    const product = productRepository.findById(productId);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (product.stock < quantity) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400 });
    }

    const cart = cartRepository.getOrCreate(userId);
    const existing = cart.items.find((i) => i.productId === productId);

    if (existing) {
      const newQty = existing.quantity + quantity;
      if (product.stock < newQty) {
        throw Object.assign(new Error('Insufficient stock'), { status: 400 });
      }
      existing.quantity = newQty;
    } else {
      cart.items.push(new CartItem({ productId, quantity, priceAtTime: product.price }));
    }

    return cartRepository.save(cart);
  },

  updateItem(userId, productId, { quantity }) {
    if (quantity <= 0) return cartService.removeItem(userId, productId);

    const product = productRepository.findById(productId);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (product.stock < quantity) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400 });
    }

    const cart = cartRepository.getOrCreate(userId);
    const item = cart.items.find((i) => i.productId === productId);
    if (!item) throw Object.assign(new Error('Item not in cart'), { status: 404 });

    item.quantity = quantity;
    return cartRepository.save(cart);
  },

  removeItem(userId, productId) {
    const cart = cartRepository.getOrCreate(userId);
    cart.items = cart.items.filter((i) => i.productId !== productId);
    return cartRepository.save(cart);
  },

  clearCart(userId) {
    return cartRepository.clear(userId);
  },
};

module.exports = cartService;
