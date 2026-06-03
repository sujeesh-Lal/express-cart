const router = require('express').Router();
const paymentController = require('../controllers/paymentController');
const authenticate = require('../middleware/authenticate');

// Stripe webhooks must receive raw body — skip JSON parsing for this route
// (When integrating Stripe for real, mount this before express.json() in app.js
//  and use express.raw({ type: 'application/json' }) for this route only)

router.post('/checkout', authenticate, paymentController.createCheckout);
router.post('/webhook', paymentController.handleWebhook);         // no auth — Stripe calls this
router.get('/:orderId', authenticate, paymentController.getPaymentStatus);

module.exports = router;
