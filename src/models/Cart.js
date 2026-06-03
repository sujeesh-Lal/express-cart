/**
 * Cart model shape
 * {
 *   id: string,
 *   userId: string,
 *   items: CartItem[],
 *   updatedAt: Date,
 * }
 */

class Cart {
  constructor({ id, userId, items = [], updatedAt }) {
    this.id = id;
    this.userId = userId;
    this.items = items;
    this.updatedAt = updatedAt || new Date();
  }

  get total() {
    return +this.items.reduce((sum, item) => sum + item.priceAtTime * item.quantity, 0).toFixed(2);
  }

  get itemCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }
}

module.exports = Cart;
