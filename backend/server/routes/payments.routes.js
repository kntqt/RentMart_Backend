const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/payments.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

router.use(verifyToken);

router.get('/', roleGuard(['admin', 'staff']), paymentsController.listPayments);
router.get('/renter/:renterId?', paymentsController.getRenterPayments);
router.post('/', roleGuard(['staff', 'admin']), paymentsController.processPayment);

module.exports = router;
