const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const verifyRole = require('../middleware/authMiddleware');

// Protected viewing routes for Admin and Staff
router.get('/', verifyRole(['Admin', 'Staff']), userController.getAllUsers);
router.get('/roles', verifyRole(['Admin', 'Staff']), userController.getRoles);

// Strict Admin-only management routes
router.post('/', verifyRole(['Admin']), userController.createUser);
router.put('/:id/role', verifyRole(['Admin']), userController.updateUserRole);
router.delete('/:id', verifyRole(['Admin']), userController.deleteUser);

module.exports = router;