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
  getCurrentUser,
  hasPermission,
} from "@/lib/auth-check";

/**
 * Every action that touches an existing row goes through this. It was inline in
 * update and delete, and the add-only rule would have had to be written twice.
 *
 * An account without `canView` is in add-only mode and sees back only what it
 * wrote; an id that is not its own reads as "not found", so ids stay
 * unprobeable — the same answer the branch check already gives.
 */
async function loadEquipmentInScope(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;

  const scope = await getBranchScope();
  const rows = await db
    .select()
    .from(equipmentExpenses)
    .where(eq(equipmentExpenses.id, id))
    .limit(1);
  if (rows.length === 0) return null;

  const inScope =
    scope.type === "all"
      ? scope.branchIds.includes(rows[0].branchId)
      : scope.branchId === rows[0].branchId;
  if (!inScope) return null;

  if (!(await hasPermission("equipment", "canView"))) {
    const user = await getCurrentUser();
    if (!user?.id || rows[0].createdByUserId !== user.id) return null;
  }

  return rows[0];
}

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
    const user = await getCurrentUser();

    await db.insert(equipmentExpenses).values({
      branchId: branch.branchId,
      equipmentName,
      cost,
      date,
      // null for the env-based owner, which has no app_users row.
      createdByUserId: user?.id ?? null,
      createdByName: user?.name ?? null,
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
    const existing = await loadEquipmentInScope(id);
    if (!existing) return { error: "Equipment not found" };

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
    const existing = await loadEquipmentInScope(id);
    if (!existing) return { error: "Equipment not found" };

    await db.delete(equipmentExpenses).where(eq(equipmentExpenses.id, id));

    revalidatePath("/admin/equipment");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete equipment") };
  }
}