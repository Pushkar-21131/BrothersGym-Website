"use server";

import { db } from "@/db";
import { membershipPlans } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";

// ===== LIST PLANS (branch-scoped) =====
export async function listPlansAction() {
  try {
    const scope = await getBranchScope();
    const rows = await db
      .select()
      .from(membershipPlans)
      .where(
        scope.type === "single"
          ? eq(membershipPlans.branchId, scope.branchId)
          : inArray(membershipPlans.branchId, scope.branchIds)
      )
      .orderBy(membershipPlans.branchId, membershipPlans.displayOrder);

    return { success: true, plans: rows };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load plans") };
  }
}

// ===== UPDATE PLAN =====
export async function updatePlanAction(id: number, formData: FormData) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can edit plans." };
  }

  const name = (formData.get("name") as string)?.trim();
  const price = parseInt(formData.get("price") as string);
  const durationDays = parseInt(formData.get("durationDays") as string);
  const description = (formData.get("description") as string)?.trim();
  const includesCardio = formData.get("includesCardio") === "true";
  const isActive = formData.get("isActive") === "true";
  const displayOrder = parseInt(formData.get("displayOrder") as string) || 0;

  if (!name || !price || !durationDays) {
    return { error: "Please fill all required fields" };
  }

  try {
    await db
      .update(membershipPlans)
      .set({
        name,
        price,
        durationDays,
        description: description || null,
        includesCardio,
        isActive,
        displayOrder,
      })
      .where(eq(membershipPlans.id, id));

    revalidatePath("/admin/plans");
    revalidatePath("/join");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to update plan") };
  }
}

// ===== TOGGLE PLAN ACTIVE STATUS =====
export async function togglePlanActiveAction(id: number, isActive: boolean) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can toggle plans." };
  }

  try {
    await db
      .update(membershipPlans)
      .set({ isActive })
      .where(eq(membershipPlans.id, id));

    revalidatePath("/admin/plans");
    revalidatePath("/join");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to toggle plan") };
  }
}