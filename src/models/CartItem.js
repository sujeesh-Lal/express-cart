/**
 * CartItem model shape
 * {
 *   productId: string,
 *   quantity: number,
 *   priceAtTime: number,   // price snapshotted when added
 * }
 */

class CartItem {
  constructor({ productId, quantity, priceAtTime }) {
    this.productId = productId;
    this.quantity = quantity;
    this.priceAtTime = priceAtTime;
  }

  get subtotal() {
    return +(this.priceAtTime * this.quantity).toFixed(2);
  }
}

module.exports = CartItem;
