/**
 * In-memory product store — replace with DB queries later.
 */
const { v4: uuidv4 } = require('uuid');
const Product = require('../models/Product');

const products = [
  new Product({ id: 'p-001', name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', price: 29.99, stock: 50, category: 'Electronics', imageUrl: '' }),
  new Product({ id: 'p-002', name: 'Mechanical Keyboard', description: 'TKL mechanical keyboard', price: 89.99, stock: 30, category: 'Electronics', imageUrl: '' }),
  new Product({ id: 'p-003', name: 'USB-C Hub', description: '7-in-1 USB-C hub', price: 49.99, stock: 20, category: 'Electronics', imageUrl: '' }),
  new Product({ id: 'p-004', name: 'Desk Lamp', description: 'LED desk lamp with USB charging', price: 34.99, stock: 40, category: 'Office', imageUrl: '' }),
  new Product({ id: 'p-005', name: 'Notebook', description: 'A5 hardcover notebook', price: 9.99, stock: 100, category: 'Stationery', imageUrl: '' }),
];

const productRepository = {
  findAll({ search, category, minPrice, maxPrice, page = 1, limit = 10 } = {}) {
    let results = [...products];

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }
    if (category) {
      results = results.filter((p) => p.category.toLowerCase() === category.toLowerCase());
    }
    if (minPrice !== undefined) results = results.filter((p) => p.price >= Number(minPrice));
    if (maxPrice !== undefined) results = results.filter((p) => p.price <= Number(maxPrice));

    const total = results.length;
    const offset = (page - 1) * limit;
    const data = results.slice(offset, offset + Number(limit));

    return { data, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) };
  },

  findById(id) {
    return products.find((p) => p.id === id) || null;
  },

  create(fields) {
    const product = new Product({ id: uuidv4(), ...fields });
    products.push(product);
    return product;
  },

  update(id, fields) {
    const product = products.find((p) => p.id === id);
    if (!product) return null;
    Object.assign(product, fields, { updatedAt: new Date() });
    return product;
  },

  delete(id) {
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    products.splice(idx, 1);
    return true;
  },

  decrementStock(id, qty) {
    const product = products.find((p) => p.id === id);
    if (!product) return null;
    product.stock -= qty;
    product.updatedAt = new Date();
    return product;
  },
};

module.exports = productRepository;
