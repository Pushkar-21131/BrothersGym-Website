"use server";

import { db } from "@/db";
import { equipmentExpenses } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import {
  assertAuthenticated,
  assertPermission,
} from "@/lib/auth-check";

// ===== LIST EQUIPMENT =====
export async function listEquipmentAction() {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("equipment", "canView");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized") };
  }

  try {
    const scope = await getBranchScope();
    const rows = await db
      .select()
      .from(equipmentExpenses)
      .where(
        scope.type === "single"
          ? eq(equipmentExpenses.branchId, scope.branchId)
          : inArray(equipmentExpenses.branchId, scope.branchIds)
      );
    return { success: true, equipment: rows };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load equipment") };
  }
}

// ===== ADD EQUIPMENT =====
export async function addEquipmentAction(formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("equipment", "canAdd");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add equipment") };
  }

  const equipmentName = (formData.get("equipmentName") as string)?.trim();
  const cost = parseInt(formData.get("cost") as string);
  const date = formData.get("date") as string;
  const formBranchId = formData.get("branchId")
    ? Number(formData.get("branchId"))
    : undefined;

  if (!equipmentName || !cost || !date) {
    return { error: "All fields required" };
  }

  try {
    const branch = await requireSingleBranch(formBranchId);

    await db.insert(equipmentExpenses).values({
      branchId: branch.branchId,
      equipmentName,
      cost,
      date,
    });

    revalidatePath("/admin/equipment");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add equipment") };
  }
}

// ===== UPDATE EQUIPMENT =====
export async function updateEquipmentAction(id: number, formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("equipment", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit equipment") };
  }

  const equipmentName = (formData.get("equipmentName") as string)?.trim();
  const cost = parseInt(formData.get("cost") as string);
  const date = formData.get("date") as string;

  try {
    const scope = await getBranchScope();
    const existing = await db
      .select()
      .from(equipmentExpenses)
      .where(eq(equipmentExpenses.id, id))
      .limit(1);
    if (existing.length === 0) return { error: "Equipment not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this equipment" };

    await db
      .update(equipmentExpenses)
      .set({ equipmentName, cost, date })
      .where(eq(equipmentExpenses.id, id));

    revalidatePath("/admin/equipment");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update equipment") };
  }
}

// ===== DELETE EQUIPMENT =====
export async function deleteEquipmentAction(id: number) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("equipment", "canDelete");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete equipment") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db
      .select()
      .from(equipmentExpenses)
      .where(eq(equipmentExpenses.id, id))
      .limit(1);
    if (existing.length === 0) return { error: "Equipment not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this equipment" };

    await db.delete(equipmentExpenses).where(eq(equipmentExpenses.id, id));

    revalidatePath("/admin/equipment");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete equipment") };
  }
}