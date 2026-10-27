const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all rentals
exports.getAllRentals = async (req, res) => {
  try {
    const rentals = await prisma.rental.findMany({
      include: {
        customer: {
          include: { user: true },
        },
        staff: true,
        rental_items: {
          include: { equipment: true },
        },
        payments: true,
      },
      orderBy: { rental_date: 'desc' },
    });
    res.json(rentals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rentals', details: error.message });
  }
};

// Get single rental by ID
exports.getRentalById = async (req, res) => {
  try {
    const { id } = req.params;
    const rental = await prisma.rental.findUnique({
      where: { rental_id: parseInt(id) },
      include: {
        customer: { include: { user: true } },
        staff: true,
        rental_items: { include: { equipment: true } },
        payments: true,
      },
    });
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    res.json(rental);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rental transaction', details: error.message });
  }
};

// Create online reservation or staff counter rental
exports.createRental = async (req, res) => {
  try {
    const { customer_id, staff_id, rental_days, total_amount, equipment_ids, is_reservation } = req.body;

    // Ensure we resolve the correct customer_id from the customer table
    let resolvedCustomerId = parseInt(customer_id);
    const customerRecord = await prisma.customer.findUnique({
      where: { customer_id: resolvedCustomerId }
    });

    if (!customerRecord) {
      // Fallback: check if the passed ID matches a user_id and find their customer profile
      const userCustomer = await prisma.customer.findFirst({
        where: { user_id: resolvedCustomerId }
      });
      if (userCustomer) {
        resolvedCustomerId = userCustomer.customer_id;
      } else {
        // If no customer profile exists yet for this user, create one automatically
        const newCust = await prisma.customer.create({
          data: { user_id: parseInt(customer_id), customer_type: 'Standard' }
        });
        resolvedCustomerId = newCust.customer_id;
      }
    }

    const days = parseInt(rental_days) || 3;
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + days);

    // If customer is reserving online from home, status is 'Reserved' with a 24-hour expiry limit
    const status = is_reservation ? 'Reserved' : 'Active';
    const expiresAt = is_reservation ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    const newRental = await prisma.rental.create({
      data: {
        customer_id: resolvedCustomerId,
        ...(staff_id && { staff_id: parseInt(staff_id) }),
        expected_return_date: returnDate,
        total_amount: parseFloat(total_amount),
        rental_status: status,
        reservation_expires_at: expiresAt,
        rental_items: {
          create: equipment_ids.map((item) => ({
            equipment_id: parseInt(item.equipment_id),
            rental_price: parseFloat(item.rental_price),
            item_condition: item.item_condition || 'Good',
          })),
        },
      },
      include: { rental_items: true },
    });

    // Update equipment status to 'Reserved' or 'Rented'
    const targetStatus = is_reservation ? 'Reserved' : 'Rented';
    for (const item of equipment_ids) {
      await prisma.equipment.update({
        where: { equipment_id: parseInt(item.equipment_id) },
        data: { equipment_status: targetStatus },
      });
    }

    res.status(201).json(newRental);
  } catch (error) {
    console.error('Create rental error:', error);
    res.status(500).json({ error: 'Failed to create reservation/rental', details: error.message });
  }
};

// Execute Stored Procedure: sp_create_rental directly in PostgreSQL
exports.createRentalViaProcedure = async (req, res) => {
  try {
    const { customer_id, staff_id, rental_days, equipment_ids } = req.body;

    if (!customer_id || !equipment_ids || equipment_ids.length === 0) {
      return res.status(400).json({ error: 'customer_id and equipment_ids array are required' });
    }

    let resolvedCustomerId = parseInt(customer_id);
    const customerRecord = await prisma.customer.findUnique({
      where: { customer_id: resolvedCustomerId }
    });
    if (!customerRecord) {
      const userCustomer = await prisma.customer.findFirst({
        where: { user_id: resolvedCustomerId }
      });
      if (userCustomer) {
        resolvedCustomerId = userCustomer.customer_id;
      }
    }

    const days = parseInt(rental_days) || 3;
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + days);
    const returnDateFormatted = returnDate.toISOString().split('T')[0];

    const eqIds = equipment_ids.map(id => parseInt(id.equipment_id || id));

    // Call server-side PostgreSQL Stored Procedure
    await prisma.$executeRawUnsafe(
      `CALL public.sp_create_rental($1::integer, $2::integer, $3::date, $4::integer[], NULL)`,
      resolvedCustomerId,
      parseInt(staff_id || req.user?.userId || 1),
      returnDateFormatted,
      eqIds
    );

    // Fetch the newly created rental record
    const created = await prisma.rental.findFirst({
      where: { customer_id: resolvedCustomerId },
      orderBy: { rental_id: 'desc' },
      include: {
        rental_items: { include: { equipment: true } },
        customer: { include: { user: true } },
        staff: true
      }
    });

    res.status(201).json({
      message: 'Rental created successfully via database Stored Procedure (sp_create_rental)',
      rental: created
    });
  } catch (error) {
    console.error('Stored procedure execution error:', error);
    res.status(500).json({
      error: 'Stored procedure execution failed: ' + error.message,
      details: error.message
    });
  }
};

// Update rental status (Staff activates/returns, Customer cancels only)
exports.updateRentalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { rental_status, staff_id, rental_days, actual_return_date } = req.body;

    let updateData = {};
    if (rental_status) updateData.rental_status = rental_status;
    if (actual_return_date) updateData.actual_return_date = new Date(actual_return_date);
    if (staff_id) updateData.staff_id = parseInt(staff_id);

    // When staff activates reservation at the store, recalculate return date based on inputted days
    if (rental_status === 'Active' && rental_days) {
      const days = parseInt(rental_days);
      const newReturnDate = new Date();
      newReturnDate.setDate(newReturnDate.getDate() + days);
      updateData.expected_return_date = newReturnDate;
      updateData.reservation_expires_at = null; // Clear expiration once active
    }

    const updatedRental = await prisma.rental.update({
      where: { rental_id: parseInt(id) },
      data: updateData,
      include: { rental_items: true },
    });

    // Handle equipment status updates (Available if returned, completed, or cancelled)
    if (['Completed', 'Returned', 'Cancelled'].includes(rental_status)) {
      const equipmentIds = updatedRental.rental_items.map((i) => i.equipment_id);
      await prisma.equipment.updateMany({
        where: { equipment_id: { in: equipmentIds } },
        data: { equipment_status: 'Available' },
      });
    } else if (rental_status === 'Active') {
      const equipmentIds = updatedRental.rental_items.map((i) => i.equipment_id);
      await prisma.equipment.updateMany({
        where: { equipment_id: { in: equipmentIds } },
        data: { equipment_status: 'Rented' },
      });
    }

    res.json(updatedRental);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update rental status', details: error.message });
  }
};
