const router = require('express').Router();
const orderController = require('../controllers/orderController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

router.post('/', orderController.checkout);
router.get('/', orderController.getMyOrders);
router.get('/admin/all', authorize('admin'), orderController.getAllOrders);
router.get('/:id', orderController.getOrder);
router.delete('/:id/cancel', orderController.cancelOrder);
router.put('/:id/status', authorize('admin'), orderController.updateOrderStatus);

module.exports = router;
