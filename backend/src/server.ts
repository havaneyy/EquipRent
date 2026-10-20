
import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma";
import equipmentRoutes from "./routes/equipment.routes";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json());

// API home
app.get("/", (_req, res) => {
  res.json({
    message: "EquipRent API is running!",
  });
});

// Database health check
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      message: "EquipRent API and database connection are working.",
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed.",
    });
  }
});

// Equipment routes
app.use("/api/equipment", equipmentRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`EquipRent API running at http://localhost:${PORT}`);
});
