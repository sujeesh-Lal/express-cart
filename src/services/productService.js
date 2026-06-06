const productRepository = require('../repositories/productRepository');

const productService = {
  async listProducts(query) {
    return productRepository.findAll(query);
  },

  async getProduct(id) {
    const product = await productRepository.findById(id);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return product;
  },

  async createProduct(fields) {
    return productRepository.create(fields);
  },

  async updateProduct(id, fields) {
    try {
      return await productRepository.update(id, fields);
    } catch (err) {
      // Prisma throws P2025 when the record doesn't exist
      if (err.code === 'P2025') throw Object.assign(new Error('Product not found'), { status: 404 });
      throw err;
    }
  },

  async deleteProduct(id) {
    try {
      await productRepository.delete(id);
    } catch (err) {
      if (err.code === 'P2025') throw Object.assign(new Error('Product not found'), { status: 404 });
      throw err;
    }
  },
};

module.exports = productService;
