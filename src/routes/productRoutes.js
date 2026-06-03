const router = require('express').Router();
const productController = require('../controllers/productController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');

// Public
router.get('/', productController.listProducts);
router.get('/:id', productController.getProduct);

// Admin only
router.post('/', authenticate, authorize('admin'), validate(validate.rules.createProduct), productController.createProduct);
router.put('/:id', authenticate, authorize('admin'), productController.updateProduct);
router.delete('/:id', authenticate, authorize('admin'), productController.deleteProduct);

module.exports = router;
