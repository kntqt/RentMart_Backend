const express = require('express');
const router = express.Router();
const rentalsController = require('../controllers/rentals.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

router.use(verifyToken);

router.get('/', roleGuard(['admin', 'staff']), rentalsController.listRentals);
router.get('/pending', roleGuard(['admin']), rentalsController.listPendingRentals);
router.get('/lookup', roleGuard(['staff', 'admin']), rentalsController.lookupRenterByEmail);
router.post('/', roleGuard(['staff', 'admin']), rentalsController.createRental);
router.patch('/:id/approve', roleGuard(['admin']), rentalsController.approveRental);
router.patch('/:id/reject', roleGuard(['admin']), rentalsController.rejectRental);

module.exports = router;
