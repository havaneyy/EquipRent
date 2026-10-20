
import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();
const equipmentStatuses = new Set(["AVAILABLE", "RENTED", "MAINTENANCE"]);
const conditionStatuses = new Set(["GOOD", "FAIR", "POOR"]);

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// GET /api/equipment - Get all equipment
router.get("/", async (_req, res) => {
  try {
    const equipment = await prisma.equipment.findMany({
      include: {
        equipment_categories: true,
      },
      orderBy: {
        equipment_id: "asc",
      },
    });

    res.json({
      success: true,
      count: equipment.length,
      data: equipment,
    });
  } catch (error) {
    console.error("Get equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve equipment.",
    });
  }
});

// GET /api/equipment/:id - Get one equipment item
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({
      success: false,
      message: "Invalid equipment ID.",
    });
    return;
  }

  try {
    const equipment = await prisma.equipment.findUnique({
      where: { equipment_id: id },
      include: {
        equipment_categories: true,
      },
    });

    if (!equipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
      return;
    }

    res.json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error("Get equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve equipment.",
    });
  }
});

// POST /api/equipment - Add new equipment
router.post("/", async (req, res) => {
  if (!isRequestBody(req.body)) {
    res.status(400).json({
      success: false,
      message: "A valid equipment request body is required.",
    });
    return;
  }

  const {
    category_id,
    equipment_name,
    description,
    rental_price,
    equipment_status,
    condition_status,
  } = req.body;

  if (
    category_id === undefined ||
    category_id === null ||
    !equipment_name ||
    rental_price === undefined ||
    rental_price === null
  ) {
    res.status(400).json({
      success: false,
      message: "Category, equipment name, and rental price are required.",
    });
    return;
  }

  const categoryId = parseNumber(category_id);
  const price = parseNumber(rental_price);

  if (
    categoryId === null ||
    !Number.isInteger(categoryId) ||
    categoryId < 1 ||
    typeof equipment_name !== "string" ||
    !equipment_name.trim() ||
    equipment_name.trim().length > 100 ||
    price === null ||
    price < 0 ||
    price > 99_999_999.99
  ) {
    res.status(400).json({
      success: false,
      message: "Please provide valid equipment details.",
    });
    return;
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    res.status(400).json({
      success: false,
      message: "Description must be text.",
    });
    return;
  }

  if (
    equipment_status !== undefined &&
    (typeof equipment_status !== "string" ||
      !equipmentStatuses.has(equipment_status))
  ) {
    res.status(400).json({
      success: false,
      message: "Please provide a valid equipment status.",
    });
    return;
  }

  if (
    condition_status !== undefined &&
    (typeof condition_status !== "string" ||
      !conditionStatuses.has(condition_status))
  ) {
    res.status(400).json({
      success: false,
      message: "Please provide a valid condition status.",
    });
    return;
  }

  try {
    const category = await prisma.equipment_categories.findUnique({
      where: { category_id: categoryId },
    });

    if (!category) {
      res.status(400).json({
        success: false,
        message: "Equipment category does not exist.",
      });
      return;
    }

    const equipment = await prisma.equipment.create({
      data: {
        category_id: categoryId,
        equipment_name: equipment_name.trim(),
        description: description ?? null,
        rental_price: price,
        equipment_status: equipment_status ?? "AVAILABLE",
        condition_status: condition_status ?? "GOOD",
        created_at: new Date(),
      },
      include: {
        equipment_categories: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Equipment added successfully.",
      data: equipment,
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2003")) {
      res.status(409).json({
        success: false,
        message: "The selected category is no longer available.",
      });
      return;
    }

    console.error("Add equipment error:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));

    res.status(500).json({
      success: false,
      message: "Failed to add equipment.",
    });
  }
});

// PUT /api/equipment/:id - Update existing equipment
router.put("/:id", async (req, res) => {
  const equipmentId = Number(req.params.id);

  if (!Number.isInteger(equipmentId) || equipmentId < 1) {
    res.status(400).json({
      success: false,
      message: "Invalid equipment ID.",
    });
    return;
  }

  if (!isRequestBody(req.body)) {
    res.status(400).json({
      success: false,
      message: "A valid equipment request body is required.",
    });
    return;
  }

  const {
    category_id,
    equipment_name,
    description,
    rental_price,
    equipment_status,
    condition_status,
  } = req.body;

  try {
    const existingEquipment = await prisma.equipment.findUnique({
      where: { equipment_id: equipmentId },
    });

    if (!existingEquipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
      return;
    }

    const updateData: {
      category_id?: number;
      equipment_name?: string;
      description?: string | null;
      rental_price?: number;
      equipment_status?: string;
      condition_status?: string;
    } = {};

    if (category_id !== undefined) {
      const categoryId = parseNumber(category_id);

      if (
        categoryId === null ||
        !Number.isInteger(categoryId) ||
        categoryId < 1
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid category ID.",
        });
        return;
      }

      const category = await prisma.equipment_categories.findUnique({
        where: { category_id: categoryId },
      });

      if (!category) {
        res.status(400).json({
          success: false,
          message: "Equipment category does not exist.",
        });
        return;
      }

      updateData.category_id = categoryId;
    }

    if (equipment_name !== undefined) {
      if (
        typeof equipment_name !== "string" ||
        !equipment_name.trim() ||
        equipment_name.trim().length > 100
      ) {
        res.status(400).json({
          success: false,
          message: "Equipment name must be between 1 and 100 characters.",
        });
        return;
      }

      updateData.equipment_name = equipment_name.trim();
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== "string") {
        res.status(400).json({
          success: false,
          message: "Description must be text or null.",
        });
        return;
      }

      updateData.description = description;
    }

    if (rental_price !== undefined) {
      const price = parseNumber(rental_price);

      if (price === null || price < 0 || price > 99_999_999.99) {
        res.status(400).json({
          success: false,
          message: "Rental price must be between 0 and 99,999,999.99.",
        });
        return;
      }

      updateData.rental_price = price;
    }

    if (equipment_status !== undefined) {
      if (
        typeof equipment_status !== "string" ||
        !equipmentStatuses.has(equipment_status)
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide a valid equipment status.",
        });
        return;
      }

      updateData.equipment_status = equipment_status;
    }

    if (condition_status !== undefined) {
      if (
        typeof condition_status !== "string" ||
        !conditionStatuses.has(condition_status)
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide a valid condition status.",
        });
        return;
      }

      updateData.condition_status = condition_status;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        message: "Provide at least one field to update.",
      });
      return;
    }

    const updatedEquipment = await prisma.equipment.update({
      where: { equipment_id: equipmentId },
      data: updateData,
      include: {
        equipment_categories: true,
      },
    });

    res.json({
      success: true,
      message: "Equipment updated successfully.",
      data: updatedEquipment,
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2025")) {
      res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
      return;
    }

    if (isPrismaErrorCode(error, "P2003")) {
      res.status(409).json({
        success: false,
        message: "The selected category is no longer available.",
      });
      return;
    }

    console.error("Update equipment error:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));

    res.status(500).json({
      success: false,
      message: "Failed to update equipment.",
    });
  }
});

// DELETE /api/equipment/:id - Delete existing equipment
router.delete("/:id", async (req, res) => {
  const equipmentId = Number(req.params.id);

  if (!Number.isInteger(equipmentId) || equipmentId < 1) {
    res.status(400).json({
      success: false,
      message: "Invalid equipment ID.",
    });
    return;
  }

  try {
    const deletedEquipment = await prisma.equipment.delete({
      where: { equipment_id: equipmentId },
    });

    res.json({
      success: true,
      message: "Equipment deleted successfully.",
      data: {
        equipment_id: equipmentId,
        equipment_name: deletedEquipment.equipment_name,
      },
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2025")) {
      res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
      return;
    }

    if (isPrismaErrorCode(error, "P2003")) {
      res.status(409).json({
        success: false,
        message:
          "This equipment is linked to rental or maintenance history and cannot be deleted without removing those records.",
      });
      return;
    }

    console.error("Delete equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete equipment.",
    });
  }
});

export default router;
