const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const verifyRole = require('../middleware/authMiddleware');

// Public viewing routes (Accessible by Customers, Technicians, Staff, and Admins)
router.get('/categories', equipmentController.getCategories);
router.get('/', equipmentController.getAllEquipment);
router.get('/:id', equipmentController.getEquipmentById);

// Creation & Modification routes (Restricted to Admin and Staff)
router.post('/', verifyRole(['Admin', 'Staff']), equipmentController.createEquipment);
router.put('/:id', verifyRole(['Admin', 'Staff']), equipmentController.updateEquipment);

// Deletion route (Strictly Admin only for maximum safety)
router.delete('/:id', verifyRole(['Admin']), equipmentController.deleteEquipment);

module.exports = router;