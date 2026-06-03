const router = require('express').Router();
const cartController = require('../controllers/cartController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', cartController.getCart);
router.post('/items', validate(validate.rules.addCartItem), cartController.addItem);
router.put('/items/:productId', validate(validate.rules.updateCartItem), cartController.updateItem);
router.delete('/items/:productId', cartController.removeItem);
router.delete('/', cartController.clearCart);

module.exports = router;
