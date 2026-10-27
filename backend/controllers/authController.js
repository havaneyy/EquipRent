const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Register a new user (dynamically links to the 'Customer' role in the normalized roles table)
exports.register = async (req, res) => {
  try {
    const { first_name, last_name, username, email, password, role_name } = req.body;

    // Check if user already exists by email or username
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already in use' });
    }

    // Default new signups securely to 'Customer'
    const targetRoleName = role_name && ['Admin', 'Staff', 'Customer'].includes(role_name) ? role_name : 'Customer';
    
    // Fetch the correct role_id from the roles table
    const roleRecord = await prisma.role.findUnique({
      where: { role_name: targetRoleName }
    });

    if (!roleRecord) {
      return res.status(400).json({ error: `Role '${targetRoleName}' does not exist in the database.` });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // Create user matching your exact schema fields
    const newUser = await prisma.user.create({
      data: {
        first_name,
        last_name,
        username,
        email,
        password_hash,
        role_id: roleRecord.role_id, // Links via foreign key to roles table
      },
      include: { role: true }
    });

    // If the registered user is a Customer, safely create their customer profile record
    if (newUser.role.role_name === 'Customer') {
      try {
        await prisma.customer.create({
          data: {
            user_id: newUser.user_id,
            customer_type: 'Standard'
          }
        });
      } catch (custErr) {
        console.error('Customer profile creation note:', custErr.message);
      }
    }

    res.status(201).json({ 
      message: 'User registered successfully', 
      userId: newUser.user_id, 
      role: newUser.role.role_name 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
};

// Login user, verify password_hash, and encode role name in JWT
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user and include the normalized role relation
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT containing user id and role name (e.g., "Customer", "Admin", "Staff")
    const token = jwt.sign(
      { id: user.user_id, role: user.role.role_name, email: user.email },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.user_id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.role.role_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
};