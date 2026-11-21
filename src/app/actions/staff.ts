"use server";

import { db } from "@/db";
import { staff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { withActivity } from "@/lib/activity";
import { formatINR } from "@/lib/utils";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";

type StaffCategory = "Trainer" | "Worker" | "Cleaner";

// ===== ADD STAFF =====
export async function addStaffAction(formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("staff", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add staff") };
  }

  const name = (formData.get("name") as string)?.trim();
  const category = formData.get("category") as StaffCategory;
  const salary = parseInt(formData.get("salary") as string);
  const contactNumber = (formData.get("contactNumber") as string)?.trim();
  const address = (formData.get("address") as string)?.trim();
  const joinDate = formData.get("joinDate") as string;
  const isActive = formData.get("isActive") === "true";
  const formBranchId = formData.get("branchId")
    ? Number(formData.get("branchId"))
    : undefined;

  if (!name || !category || !salary || !contactNumber || !joinDate) {
    return { error: "Please fill all required fields" };
  }

  try {
    const branch = await requireSingleBranch(formBranchId);

    await withActivity("staff.created", `Added ${name} · ${category} · salary ${formatINR(salary)}`, {
      branchId: branch.branchId,
    }, async (tx) => tx.insert(staff).values({
      branchId: branch.branchId,
      name,
      category,
      salary,
      contactNumber,
      address: address || null,
      joinDate,
      isActive,
    }));

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add staff") };
  }
}

// ===== UPDATE STAFF =====
export async function updateStaffAction(id: number, formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("staff", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit staff") };
  }

  const name = (formData.get("name") as string)?.trim();
  const category = formData.get("category") as StaffCategory;
  const salary = parseInt(formData.get("salary") as string);
  const contactNumber = (formData.get("contactNumber") as string)?.trim();
  const address = (formData.get("address") as string)?.trim();
  const joinDate = formData.get("joinDate") as string;
  const isActive = formData.get("isActive") === "true";

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    if (existing.length === 0) return { error: "Staff not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this staff member" };

    await withActivity("staff.updated", `Updated ${name} · ${category} · salary ${formatINR(salary)}`, {
      branchId: existing[0].branchId, subjectId: id,
    }, async (tx) => tx
      .update(staff)
      .set({
        name,
        category,
        salary,
        contactNumber,
        address: address || null,
        joinDate,
        isActive,
      })
      .where(eq(staff.id, id)));

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update staff") };
  }
}

// ===== DELETE STAFF =====
export async function deleteStaffAction(id: number) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("staff", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete staff") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    if (existing.length === 0) return { error: "Staff not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this staff member" };

    await withActivity("staff.deleted", `Deleted staff member ${existing[0].name}`, {
      branchId: existing[0].branchId, subjectId: id,
    }, async (tx) => tx.delete(staff).where(eq(staff.id, id)));

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete staff") };
  }
}
