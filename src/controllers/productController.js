const productService = require('../services/productService');

const productController = {
  async listProducts(req, res, next) {
    try {
      const result = await productService.listProducts(req.query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getProduct(req, res, next) {
    try {
      const product = await productService.getProduct(req.params.id);
      res.json(product);
    } catch (err) {
      next(err);
    }
  },

  async createProduct(req, res, next) {
    try {
      const product = await productService.createProduct(req.body);
      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  },

  async updateProduct(req, res, next) {
    try {
      const product = await productService.updateProduct(req.params.id, req.body);
      res.json(product);
    } catch (err) {
      next(err);
    }
  },

  async deleteProduct(req, res, next) {
    try {
      await productService.deleteProduct(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // ── Service-to-service endpoints ──────────────────────────────────────────

  async decrementStock(req, res, next) {
    try {
      const { quantity } = req.body;
      if (!quantity || quantity < 1) {
        return res.status(400).json({ error: 'quantity must be a positive integer' });
      }
      const product = await productService.decrementStock(req.params.id, Number(quantity));
      res.json(product);
    } catch (err) {
      next(err);
    }
  },

  async releaseStock(req, res, next) {
    try {
      const { quantity } = req.body;
      if (!quantity || quantity < 1) {
        return res.status(400).json({ error: 'quantity must be a positive integer' });
      }
      const product = await productService.releaseStock(req.params.id, Number(quantity));
      res.json(product);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = productController;
