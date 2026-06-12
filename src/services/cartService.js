const cartRepository = require('../repositories/cartRepository');
const productRepository = require('../repositories/productRepository');
const productClient = require('../clients/productClient');
const { services } = require('../config/env');

/**
 * Resolve product data from either the remote Product Service (microservice mode)
 * or the local repository (monolith mode).
 *
 * Microservice mode is active when PRODUCT_SERVICE_URL is set in env.
 */
async function resolveProduct(productId) {
  if (services.productServiceUrl) {
    return productClient.getProduct(productId);
  }
  return productRepository.findById(productId);
}

/** Compute total and itemCount from Prisma cart (plain object). */
function formatCart(cart) {
  const total = cart.items.reduce((sum, item) => sum + item.priceAtTime * item.quantity, 0);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  return { ...cart, total: +total.toFixed(2), itemCount };
}

const cartService = {
  async getCart(userId) {
    const cart = await cartRepository.getOrCreate(userId);
    return formatCart(cart);
  },

  async addItem(userId, { productId, quantity = 1 }) {
    // Resolve product — uses HTTP client when in microservice mode
    const product = await resolveProduct(productId);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });

    const cart = await cartRepository.getOrCreate(userId);

    // Calculate the new total quantity (existing + requested)
    const existing = cart.items.find((i) => i.productId === productId);
    const newQty = (existing ? existing.quantity : 0) + quantity;

    if (product.stock < newQty) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400 });
    }

    const updated = await cartRepository.upsertItem(cart.id, {
      productId,
      quantity: newQty,
      priceAtTime: product.price,
    });

    return formatCart(updated);
  },

  async updateItem(userId, productId, { quantity }) {
    if (quantity <= 0) return cartService.removeItem(userId, productId);

    const product = await resolveProduct(productId);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (product.stock < quantity) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400 });
    }

    const cart = await cartRepository.getOrCreate(userId);
    const item = cart.items.find((i) => i.productId === productId);
    if (!item) throw Object.assign(new Error('Item not in cart'), { status: 404 });

    const updated = await cartRepository.upsertItem(cart.id, {
      productId,
      quantity,
      priceAtTime: item.priceAtTime, // keep original snapshot price
    });

    return formatCart(updated);
  },

  async removeItem(userId, productId) {
    const cart = await cartRepository.getOrCreate(userId);
    const updated = await cartRepository.removeItem(cart.id, productId);
    return formatCart(updated);
  },

  async clearCart(userId) {
    const cart = await cartRepository.clear(userId);
    return cart ? formatCart(cart) : null;
  },
};

module.exports = cartService;
