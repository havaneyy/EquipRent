const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenanceController');
const verifyRole = require('../middleware/authMiddleware');

// Viewing maintenance records
router.get('/', verifyRole(['Admin', 'Staff', 'Technician']), maintenanceController.getAllMaintenance);

// Creating maintenance logs (Staff/Admin/Technician)
router.post('/', verifyRole(['Admin', 'Staff', 'Technician']), maintenanceController.createMaintenance);

// Assigning technicians and completing maintenance (Admin, Staff, or Technician only)
router.post('/assign', verifyRole(['Admin', 'Staff']), maintenanceController.assignTechnician);
router.put('/:id/complete', verifyRole(['Admin', 'Staff', 'Technician']), maintenanceController.completeMaintenance);

module.exports = router;