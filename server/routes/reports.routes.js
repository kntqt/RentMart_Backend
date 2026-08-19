const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

router.use(verifyToken);

router.get('/admin', roleGuard(['admin']), reportsController.getAdminDashboard);
router.get('/staff', roleGuard(['staff', 'admin']), reportsController.getStaffDashboard);
router.get('/renter', roleGuard(['renter', 'admin']), reportsController.getRenterDashboard);

module.exports = router;
