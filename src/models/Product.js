/**
 * Product model shape
 * {
 *   id: string,
 *   name: string,
 *   description: string,
 *   price: number,
 *   stock: number,
 *   category: string,
 *   imageUrl: string,
 *   createdAt: Date,
 *   updatedAt: Date,
 * }
 */

class Product {
  constructor({ id, name, description, price, stock, category, imageUrl, createdAt, updatedAt }) {
    this.id = id;
    this.name = name;
    this.description = description || '';
    this.price = price;
    this.stock = stock;
    this.category = category || '';
    this.imageUrl = imageUrl || '';
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }
}

module.exports = Product;
