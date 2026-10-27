const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all equipment items with category details
exports.getAllEquipment = async (req, res) => {
  try {
    const equipment = await prisma.equipment.findMany({
      include: {
        category: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
    res.json(equipment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch equipment', details: error.message });
  }
};

// Get single equipment item by ID
exports.getEquipmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.equipment.findUnique({
      where: { equipment_id: parseInt(id) },
      include: {
        category: true,
        maintenance_records: true,
      },
    });
    if (!item) return res.status(404).json({ error: 'Equipment not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch equipment item', details: error.message });
  }
};

// Create new equipment item + Automatic Audit Log
exports.createEquipment = async (req, res) => {
  try {
    const { category_id, equipment_name, description, rental_price, equipment_status, condition_status } = req.body;
    
    const newEquipment = await prisma.equipment.create({
      data: {
        category_id: parseInt(category_id),
        equipment_name,
        description: description || '',
        rental_price: parseFloat(rental_price),
        equipment_status: equipment_status || 'Available',
        condition_status: condition_status || 'Good',
      },
    });

    // Automatically create Audit Log entry
    try {
      await prisma.auditLog.create({
        data: {
          action: 'INSERT',
          table_name: 'equipment',
          record_id: newEquipment.equipment_id,
        }
      });
    } catch (auditErr) {
      console.error('⚠️ Audit log creation failed:', auditErr.message);
    }

    res.status(201).json(newEquipment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create equipment', details: error.message });
  }
};

// Update equipment details, status, rentals sync, maintenance sync, and audit logs
exports.updateEquipment = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, equipment_name, description, rental_price, equipment_status, condition_status } = req.body;

    // 1. Fetch current equipment state to check previous status
    const oldEquipment = await prisma.equipment.findUnique({
      where: { equipment_id: parseInt(id) }
    });

    if (!oldEquipment) {
      return res.status(404).json({ error: 'Equipment not found' });
    }

    // 2. Update the equipment record
    const updatedEquipment = await prisma.equipment.update({
      where: { equipment_id: parseInt(id) },
      data: {
        ...(category_id && { category_id: parseInt(category_id) }),
        ...(equipment_name && { equipment_name }),
        ...(description !== undefined && { description }),
        ...(rental_price && { rental_price: parseFloat(rental_price) }),
        ...(equipment_status && { equipment_status }),
        ...(condition_status && { condition_status }),
      },
    });

    // 3. AUTOMATIC AUDIT LOG: Record update action
    try {
      await prisma.auditLog.create({
        data: {
          action: 'UPDATE',
          table_name: 'equipment',
          record_id: updatedEquipment.equipment_id,
        }
      });
    } catch (auditErr) {
      console.error('⚠️ Audit log update failed:', auditErr.message);
    }

    // 4. RENTALS SYNCHRONIZATION: If changed TO 'Rented'
    if (equipment_status === 'Rented' && oldEquipment.equipment_status !== 'Rented') {
      try {
        await prisma.rental.create({
          data: {
            customer_id: 1,
            staff_id: 1,
            expected_return_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            total_amount: updatedEquipment.rental_price || 0,
            rental_status: 'Active',
            rental_items: {
              create: [{
                equipment_id: updatedEquipment.equipment_id,
                rental_price: updatedEquipment.rental_price || 0,
                item_condition: condition_status || 'Good'
              }]
            }
          }
        });
        console.log(`✅ Auto-created active rental for Equipment #${updatedEquipment.equipment_id}`);
      } catch (rentalErr) {
        console.error('⚠️ Failed to auto-create rental record:', rentalErr.message);
      }
    }

    // 5. RENTALS SYNCHRONIZATION: If changed FROM 'Rented' TO 'Available'
    if (equipment_status === 'Available' && oldEquipment.equipment_status === 'Rented') {
      try {
        const activeRentalItems = await prisma.rentalItem.findMany({
          where: {
            equipment_id: parseInt(id),
            rental: { rental_status: 'Active' }
          },
          include: { rental: true }
        });

        for (const ri of activeRentalItems) {
          await prisma.rental.update({
            where: { rental_id: ri.rental_id },
            data: { 
              rental_status: 'Returned',
              actual_return_date: new Date() 
            }
          });
        }
        console.log(`✅ Auto-returned rentals for Equipment #${id}`);
      } catch (returnErr) {
        console.error('⚠️ Failed to auto-return rental record:', returnErr.message);
      }
    }

    // 6. MAINTENANCE SYNCHRONIZATION: If changed TO 'Under Maintenance'
    if (equipment_status === 'Under Maintenance' && oldEquipment.equipment_status !== 'Under Maintenance') {
      try {
        await prisma.maintenanceRecord.create({
          data: {
            description: description || 'Scheduled routine maintenance or repair check.',
            maintenance_status: 'Pending',
            maintenance_date: new Date(),
            equipment: {
              connect: { equipment_id: parseInt(id) }
            },
            requester: {
              connect: { user_id: 1 }
            }
          }
        });
        console.log(`✅ Auto-created maintenance record for Equipment #${id}`);
      } catch (maintErr) {
        console.error('⚠️ Failed to auto-create maintenance record:', maintErr.message);
      }
    }

    // 7. MAINTENANCE SYNCHRONIZATION: If changed FROM 'Under Maintenance' to 'Available'
    if (equipment_status === 'Available' && oldEquipment.equipment_status === 'Under Maintenance') {
      try {
        const pendingMaint = await prisma.maintenanceRecord.findMany({
          where: {
            equipment_id: parseInt(id),
            maintenance_status: 'Pending'
          }
        });

        for (const m of pendingMaint) {
          await prisma.maintenanceRecord.update({
            where: { maintenance_id: m.maintenance_id },
            data: { maintenance_status: 'Completed' }
          });
        }
        console.log(`✅ Marked maintenance completed for Equipment #${id}`);
      } catch (maintUpdateErr) {
        console.error('⚠️ Failed to update maintenance status:', maintUpdateErr.message);
      }
    }

    res.json(updatedEquipment);
  } catch (error) {
    console.error('❌ Error updating equipment status sync:', error);
    res.status(500).json({ error: 'Failed to update equipment', details: error.message });
  }
};

// Delete equipment item + Automatic Audit Log
exports.deleteEquipment = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.equipment.delete({
      where: { equipment_id: parseInt(id) },
    });

    // Automatically create Audit Log entry for deletion
    try {
      await prisma.auditLog.create({
        data: {
          action: 'DELETE',
          table_name: 'equipment',
          record_id: parseInt(id),
        }
      });
    } catch (auditErr) {
      console.error('⚠️ Audit log deletion record failed:', auditErr.message);
    }

    res.json({ message: 'Equipment deleted successfully' });
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(409).json({
        error: 'Referential Integrity Constraint (ON DELETE RESTRICT): Cannot delete equipment because it is currently linked to active rental items or maintenance records.'
      });
    }
    res.status(500).json({ error: 'Failed to delete equipment', details: error.message });
  }
};

// Get all equipment categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await prisma.equipmentCategory.findMany({
      include: {
        _count: {
          select: { equipment: true },
        },
      },
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
};