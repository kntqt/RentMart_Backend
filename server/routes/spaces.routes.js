const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const spacesController = require('../controllers/spaces.controller');
const verifyToken = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `space_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

router.get('/', spacesController.listSpaces); // Public / Auth accessible
router.get('/:id', spacesController.getSpaceById);

router.use(verifyToken);
router.post('/', roleGuard(['admin']), upload.single('image'), spacesController.createSpace);
router.put('/:id', roleGuard(['admin', 'staff']), upload.single('image'), spacesController.updateSpace);
router.patch('/:id/status', roleGuard(['admin', 'staff']), spacesController.updateSpaceStatus);

module.exports = router;
