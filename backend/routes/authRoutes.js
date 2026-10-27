const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'equiprent_secret_key_101';

// Register Route (Forced Customer role for public safety during presentation)
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Please provide all required fields' });
    }

    const existingUser = await prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    let baseUsername = email.split('@')[0];
    let username = baseUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    // Force public registration to always be Customer (Role ID 4)
    const resolvedRoleId = 4;

    const newUser = await prisma.user.create({
      data: {
        username,
        email,
        password_hash: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        role_id: resolvedRoleId,
      },
      include: { role: true },
    });

    if (newUser.role_id === 4 || (newUser.role && newUser.role.role_name === 'Customer')) {
      await prisma.customer.create({
        data: {
          user_id: newUser.user_id,
          customer_type: 'Standard',
        },
      }).catch(err => console.log('Customer profile note:', err.message));
    }

    const token = jwt.sign(
      { userId: newUser.user_id, email: newUser.email, roleId: newUser.role_id, role: newUser.role ? newUser.role.role_name : 'Customer' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser.user_id,
        email: newUser.email,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        role_id: newUser.role_id,
        role: newUser.role ? newUser.role.role_name : 'Customer',
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.user_id, email: user.email, roleId: user.role_id, role: user.role ? user.role.role_name : 'Customer' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.user_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        role: user.role ? user.role.role_name : 'Customer',
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// Get Current User Profile Route
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { user_id: decoded.userId },
      include: { role: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user_id: user.user_id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role_id: user.role_id,
      role: user.role ? user.role.role_name : 'Customer',
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;