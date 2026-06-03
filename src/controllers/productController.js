const productService = require('../services/productService');

const productController = {
  listProducts(req, res, next) {
    try {
      const result = productService.listProducts(req.query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  getProduct(req, res, next) {
    try {
      const product = productService.getProduct(req.params.id);
      res.json(product);
    } catch (err) {
      next(err);
    }
  },

  createProduct(req, res, next) {
    try {
      const product = productService.createProduct(req.body);
      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  },

  updateProduct(req, res, next) {
    try {
      const product = productService.updateProduct(req.params.id, req.body);
      res.json(product);
    } catch (err) {
      next(err);
    }
  },

  deleteProduct(req, res, next) {
    try {
      productService.deleteProduct(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};

module.exports = productController;
