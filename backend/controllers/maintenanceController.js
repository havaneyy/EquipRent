const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all maintenance records with equipment, requester, and assignments
exports.getAllMaintenance = async (req, res) => {
  try {
    const records = await prisma.maintenanceRecord.findMany({
      include: {
        equipment: true,
        requester: true,
        maintenance_assignments: {
          include: {
            technician: true,
          },
        },
      },
      orderBy: {
        maintenance_date: 'desc',
      },
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch maintenance records', details: error.message });
  }
};

// Create a new maintenance request
exports.createMaintenance = async (req, res) => {
  try {
    const { equipment_id, requested_by, description } = req.body;

    const newRecord = await prisma.maintenanceRecord.create({
      data: {
        equipment_id: parseInt(equipment_id),
        requested_by: parseInt(requested_by),
        description,
        maintenance_status: 'Pending',
      },
    });

    // Update equipment status to 'Maintenance'
    await prisma.equipment.update({
      where: { equipment_id: parseInt(equipment_id) },
      data: { equipment_status: 'Maintenance' },
    });

    res.status(201).json(newRecord);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create maintenance record', details: error.message });
  }
};

// Assign a technician to a maintenance record
exports.assignTechnician = async (req, res) => {
  try {
    const { maintenance_id, technician_id } = req.body;

    const assignment = await prisma.maintenanceAssignment.create({
      data: {
        maintenance_id: parseInt(maintenance_id),
        technician_id: parseInt(technician_id),
        assignment_status: 'Assigned',
      },
    });

    // Update maintenance status to 'In Progress'
    await prisma.maintenanceRecord.update({
      where: { maintenance_id: parseInt(maintenance_id) },
      data: { maintenance_status: 'In Progress' },
    });

    res.status(201).json(assignment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign technician', details: error.message });
  }
};

// Complete a maintenance record
exports.completeMaintenance = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await prisma.maintenanceRecord.update({
      where: { maintenance_id: parseInt(id) },
      data: { maintenance_status: 'Completed' },
      include: { equipment: true },
    });

    // Set equipment status back to 'Available'
    await prisma.equipment.update({
      where: { equipment_id: updated.equipment_id },
      data: { equipment_status: 'Available', condition_status: 'Good' },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete maintenance', details: error.message });
  }
};