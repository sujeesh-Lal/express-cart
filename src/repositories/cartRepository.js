const prisma = require('../config/prismaClient');

/** Include items with product info on every cart query. */
const CART_INCLUDE = { items: { include: { product: true } } };

const cartRepository = {
  async findByUserId(userId) {
    return prisma.cart.findUnique({ where: { userId }, include: CART_INCLUDE });
  },

  /** Returns the cart, creating it if it doesn't exist yet. */
  async getOrCreate(userId) {
    return prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: CART_INCLUDE,
    });
  },

  /**
   * Create or update a single cart item (upsert by cartId + productId).
   * Returns the full updated cart.
   */
  async upsertItem(cartId, { productId, quantity, priceAtTime }) {
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity, priceAtTime },
      update: { quantity, priceAtTime },
    });

    return prisma.cart.findUnique({ where: { id: cartId }, include: CART_INCLUDE });
  },

  /** Remove a single item from the cart. Returns the updated cart. */
  async removeItem(cartId, productId) {
    await prisma.cartItem.deleteMany({ where: { cartId, productId } });
    return prisma.cart.findUnique({ where: { id: cartId }, include: CART_INCLUDE });
  },

  /** Remove all items from the user's cart. Returns the cleared cart. */
  async clear(userId) {
    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) return null;
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return prisma.cart.findUnique({ where: { userId }, include: CART_INCLUDE });
  },
};

module.exports = cartRepository;
