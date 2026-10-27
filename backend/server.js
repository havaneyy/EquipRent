const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Load environment variables (.env in backend or root)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
const equipmentRoutes = require('./routes/equipmentRoutes');
const userRoutes = require('./routes/userRoutes');
const rentalRoutes = require('./routes/rentalRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const auditRoutes = require('./routes/auditRoutes');
const authRoutes = require('./routes/authRoutes');

app.use('/api/equipment', equipmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/auth', authRoutes);

// Base API route
app.get('/api', (req, res) => {
  res.json({ status: 'ok', service: 'EquipRent API', database: 'Supabase PostgreSQL' });
});

// Health & DB test route
app.get('/api/test-db', async (req, res) => {
  try {
    const roles = await prisma.role.findMany();
    res.json({ message: 'Database connection successful!', roles });
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// Serve frontend static build if present (for single production server)
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

// SPA fallback routing
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const indexPath = path.join(frontendDist, 'index.html');
    if (require('fs').existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  next();
});

// Start listener only when running standalone (not serverless on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`EquipRent server running on port ${PORT}`);
  });
}

module.exports = app;
