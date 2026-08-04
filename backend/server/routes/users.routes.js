const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

router.use(verifyToken);

router.get('/', roleGuard(['admin', 'staff']), usersController.listUsers);
router.get('/renters', roleGuard(['admin', 'staff']), usersController.listRenters);
router.post('/', roleGuard(['admin']), usersController.createUser);
router.put('/:id', roleGuard(['admin']), usersController.updateUser);
router.patch('/:id/status', roleGuard(['admin']), usersController.toggleStatus);
router.patch('/:id/approve', roleGuard(['admin']), usersController.approveRenter);
router.patch('/:id/reject', roleGuard(['admin']), usersController.rejectRenter);
router.delete('/:id', roleGuard(['admin']), usersController.deleteUser);

module.exports = router;
