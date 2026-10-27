const express = require('express');
const router = express.Router();
const rentalController = require('../controllers/rentalController');
const verifyRole = require('../middleware/authMiddleware');

// Viewing rentals (Admin, Staff, or Customer viewing records)
router.get('/', rentalController.getAllRentals);
router.get('/:id', rentalController.getRentalById);

// Online customer reservations & counter rentals
router.post('/', rentalController.createRental);

// Stored Procedure counter rental checkout (Explicitly invokes PostgreSQL sp_create_rental)
router.post('/procedure', verifyRole(['Admin', 'Staff']), rentalController.createRentalViaProcedure);

// Status updates: Admin and Staff handle activations/returns, Customers handle cancellations
router.put('/:id/status', verifyRole(['Admin', 'Staff', 'Customer']), rentalController.updateRentalStatus);

module.exports = router;
