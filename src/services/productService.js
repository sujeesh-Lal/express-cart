const productRepository = require('../repositories/productRepository');

const productService = {
  listProducts(query) {
    return productRepository.findAll(query);
  },

  getProduct(id) {
    const product = productRepository.findById(id);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return product;
  },

  createProduct(fields) {
    return productRepository.create(fields);
  },

  updateProduct(id, fields) {
    const product = productRepository.update(id, fields);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return product;
  },

  deleteProduct(id) {
    const deleted = productRepository.delete(id);
    if (!deleted) throw Object.assign(new Error('Product not found'), { status: 404 });
  },
};

module.exports = productService;
