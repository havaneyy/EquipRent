const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all users with their roles and customer info
exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        role: true,
        customer: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
};

// Get all system roles
exports.getRoles = async (req, res) => {
  try {
    const roles = await prisma.role.findMany();
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles', details: error.message });
  }
};

// Create a new user (Admin only)
exports.createUser = async (req, res) => {
  try {
    const { role_id, first_name, last_name, username, password_hash, email, phone_number, street, barangay, city } = req.body;
    
    const newUser = await prisma.user.create({
      data: {
        role_id: parseInt(role_id),
        first_name,
        last_name,
        username,
        password_hash,
        email,
        phone_number,
        street,
        barangay,
        city,
      },
      include: { role: true }
    });

    if (newUser.role && newUser.role.role_name === 'Customer') {
      await prisma.customer.create({
        data: { user_id: newUser.user_id, customer_type: 'Standard' }
      }).catch(() => {});
    }

    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
};

// Update User Role (Admin only)
exports.updateUserRole = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role_id } = req.body;

    if (!role_id) {
      return res.status(400).json({ error: 'role_id is required' });
    }

    const newRole = await prisma.role.findUnique({
      where: { role_id: parseInt(role_id) }
    });

    if (!newRole) {
      return res.status(400).json({ error: 'Invalid role_id provided' });
    }

    const updatedUser = await prisma.user.update({
      where: { user_id: userId },
      data: { role_id: parseInt(role_id) },
      include: { role: true, customer: true }
    });

    // Automatically provision customer profile if role becomes Customer
    if (newRole.role_name === 'Customer' && !updatedUser.customer) {
      await prisma.customer.create({
        data: { user_id: userId, customer_type: 'Standard' }
      }).catch(() => {});
    }

    res.json({ message: 'User role updated successfully', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user role', details: error.message });
  }
};

// Delete a user (Admin only)
exports.deleteUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from deleting their own active account
    if (req.user && req.user.userId === userId) {
      return res.status(400).json({ error: 'You cannot delete your own active admin account.' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { user_id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.user.delete({
      where: { user_id: userId },
    });

    res.json({ message: 'User deleted successfully', user_id: userId });
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(409).json({
        error: 'Referential Integrity Constraint (ON DELETE RESTRICT): Cannot delete user because active operational records (rentals, maintenance assignments, or audit logs) depend on this user account.'
      });
    }
    res.status(500).json({ error: 'Failed to delete user', details: error.message });
  }
};