const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all audit log records with user details
exports.getAllAuditLogs = async (req, res) => {
  try {
    const auditLogs = await prisma.auditLog.findMany({
      include: {
        user: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
    res.json(auditLogs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs', details: error.message });
  }
};