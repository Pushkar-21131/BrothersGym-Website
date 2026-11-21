"use server";

import { db } from "@/db";
import { equipmentExpenses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { recordActivity, withActivity } from "@/lib/activity";
import { activityChanges } from "@/lib/activity-history";
import { formatINR } from "@/lib/utils";
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

  if (!equipmentName || !Number.isInteger(cost) || cost <= 0 || !date) {
    return { error: "All fields required" };
  }

  try {
    const branch = await requireSingleBranch(formBranchId);
    const user = await getCurrentUser();

    await withActivity("equipment.added", `Added ${equipmentName} · ${formatINR(cost)} · expense dated ${date}`, {
      branchId: branch.branchId, actor: user,
    }, async (tx) => tx.insert(equipmentExpenses).values({
      branchId: branch.branchId,
      equipmentName,
      cost,
      date,
      // null for the env-based owner, which has no app_users row.
      createdByUserId: user?.id ?? null,
      createdByName: user?.name ?? null,
    }));

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

  if (!equipmentName || !Number.isInteger(cost) || cost <= 0 || !date) {
    return { error: "Enter an equipment name, positive cost and date" };
  }

  try {
    const existing = await loadEquipmentInScope(id);
    if (!existing) return { error: "Equipment not found" };

    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(equipmentExpenses).where(eq(equipmentExpenses.id, id)).for("update");
      if (!before) throw new Error("Equipment not found");
      const [after] = await tx.update(equipmentExpenses).set({ equipmentName, cost, date }).where(eq(equipmentExpenses.id, id)).returning();
      const changes = activityChanges(before, after);
      if (changes.length) {
        await recordActivity(tx, "equipment.updated", `Updated ${equipmentName} · expense #${id}`, {
          branchId: before.branchId, subjectId: id, changes,
        });
      }
    });

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

    await withActivity("equipment.deleted", `Deleted ${existing.equipmentName} · ${formatINR(existing.cost)} · expense dated ${existing.date}`, {
      branchId: existing.branchId, subjectId: id,
    }, async (tx) => tx.delete(equipmentExpenses).where(eq(equipmentExpenses.id, id)));

    revalidatePath("/admin/equipment");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete equipment") };
  }
}
