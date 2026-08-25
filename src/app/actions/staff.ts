"use server";

import { db } from "@/db";
import { staff } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";

type StaffCategory = "Trainer" | "Worker" | "Cleaner";

// ===== LIST STAFF =====
export async function listStaffAction() {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("staff", "canView");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized") };
  }

  try {
    const scope = await getBranchScope();
    const rows = await db
      .select()
      .from(staff)
      .where(
        scope.type === "single"
          ? eq(staff.branchId, scope.branchId)
          : inArray(staff.branchId, scope.branchIds)
      );
    return { success: true, staff: rows };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load staff") };
  }
}

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

    await db.insert(staff).values({
      branchId: branch.branchId,
      name,
      category,
      salary,
      contactNumber,
      address: address || null,
      joinDate,
      isActive,
    });

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

    await db
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
      .where(eq(staff.id, id));

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

    await db.delete(staff).where(eq(staff.id, id));

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete staff") };
  }
}

// ===== TOTAL STAFF SALARIES =====
export async function getTotalStaffSalaries() {
  try {
    const scope = await getBranchScope();
    const rows = await db
      .select({ salary: staff.salary })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, true),
          scope.type === "single"
            ? eq(staff.branchId, scope.branchId)
            : inArray(staff.branchId, scope.branchIds)
        )
      );
    return rows.reduce((sum, r) => sum + (Number(r.salary) || 0), 0);
  } catch {
    return 0;
  }
}