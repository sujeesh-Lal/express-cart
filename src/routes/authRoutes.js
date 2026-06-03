const router = require('express').Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');

router.post('/register', validate(validate.rules.register), authController.register);
router.post('/login', validate(validate.rules.login), authController.login);
router.post('/logout', authController.logout);
router.post('/refresh-token', authController.refreshToken);

module.exports = router;
