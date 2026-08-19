const express = require('express');
const router = express.Router();
const rentalsController = require('../controllers/rentals.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

// Renter self-service rental request (must be before /:id routes)
router.post('/renter-request', verifyToken, roleGuard(['renter']), rentalsController.renterRequestRental);

// Renter view own rentals
router.get('/my-rentals', verifyToken, roleGuard(['renter']), rentalsController.getMyRentals);

// Protected routes requiring auth
router.use(verifyToken);

router.get('/', roleGuard(['admin', 'staff']), rentalsController.listRentals);
router.get('/pending', roleGuard(['admin']), rentalsController.listPendingRentals);
router.get('/lookup', roleGuard(['staff', 'admin']), rentalsController.lookupRenterByEmail);
router.post('/', roleGuard(['staff', 'admin']), rentalsController.createRental);
router.patch('/:id/approve', roleGuard(['admin']), rentalsController.approveRental);
router.patch('/:id/reject', roleGuard(['admin']), rentalsController.rejectRental);
router.patch('/:id/cancel', roleGuard(['admin']), rentalsController.cancelRental);
router.patch('/:id/complete', roleGuard(['admin']), rentalsController.completeRental);

module.exports = router;
