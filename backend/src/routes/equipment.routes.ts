
import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

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
      message:
        "Category, equipment name, and rental price are required.",
    });
    return;
  }

  const categoryId = Number(category_id);
  const price = Number(rental_price);

  if (
    !Number.isInteger(categoryId) ||
    categoryId < 1 ||
    typeof equipment_name !== "string" ||
    !equipment_name.trim() ||
    !Number.isFinite(price) ||
    price < 0
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

  try {
    const category = await prisma.equipment_categories.findUnique({
      where: {
        category_id: categoryId,
      },
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
      const categoryId = Number(category_id);

      if (!Number.isInteger(categoryId) || categoryId < 1) {
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
        !equipment_name.trim()
      ) {
        res.status(400).json({
          success: false,
          message: "Equipment name cannot be empty.",
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
      const price = Number(rental_price);

      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({
          success: false,
          message: "Rental price must be a valid non-negative number.",
        });
        return;
      }

      updateData.rental_price = price;
    }

    if (equipment_status !== undefined) {
      if (typeof equipment_status !== "string") {
        res.status(400).json({
          success: false,
          message: "Equipment status must be text.",
        });
        return;
      }

      updateData.equipment_status = equipment_status;
    }

    if (condition_status !== undefined) {
      if (typeof condition_status !== "string") {
        res.status(400).json({
          success: false,
          message: "Condition status must be text.",
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
    console.error("Update equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update equipment.",
    });
  }
});


/**
 * DELETE /api/equipment/:id
 * Delete an existing equipment record.
 */
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
    const existingEquipment = await prisma.equipment.findUnique({
      where: {
        equipment_id: equipmentId,
      },
    });

    if (!existingEquipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
      return;
    }

    await prisma.equipment.delete({
      where: {
        equipment_id: equipmentId,
      },
    });

    res.json({
      success: true,
      message: "Equipment deleted successfully.",
      data: {
        equipment_id: equipmentId,
        equipment_name: existingEquipment.equipment_name,
      },
    });
  } catch (error) {
    console.error("Delete equipment error:", error);

    res.status(500).json({
      success: false,
      message:
        "Failed to delete equipment. It may be linked to existing rental or maintenance records.",
    });
  }
});

export default router;
