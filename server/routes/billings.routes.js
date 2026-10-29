const express = require('express');
const router = express.Router();
const billingsController = require('../controllers/billings.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

router.use(verifyToken);

router.get('/', roleGuard(['admin', 'staff']), billingsController.listBillings);
router.post('/setup', roleGuard(['staff', 'admin']), billingsController.setupBilling);
router.patch('/:id/status', roleGuard(['staff', 'admin']), billingsController.updateBillingStatus);
router.delete('/:id', roleGuard(['staff', 'admin']), billingsController.deleteBilling);

module.exports = router;
