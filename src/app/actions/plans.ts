"use server";

import { db } from "@/db";
import { membershipPlans } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { getBranchScope, isBranchInScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";

/**
 * Spelled out rather than inferred. Both mutating actions mix a named
 * `{ error: string }` from assertPlanInScope with fresh object literals, and
 * what TypeScript infers from that mixture is not stable enough for the client
 * to narrow — the toast call ends up seeing `string | undefined`. Declaring it
 * makes `if (r.error)` mean what it reads like at the call site.
 */
export type PlanActionResult =
  | { error: string; success?: undefined }
  | { success: true; error?: undefined };

/**
 * Confirm a plan exists AND belongs to a branch the caller may touch.
 *
 * `assertOwner()` alone is not enough here: prices and plan names are per
 * branch (membershipPlans.branchId), and with a separate owner per gym "is an
 * owner" and "owns THIS plan" are different questions. Without this an NR owner
 * could re-price an SP plan by guessing its id.
 *
 * Returns the same message for "no such plan" as for "another branch's plan" so
 * the other gym's plan ids cannot be enumerated by probing.
 */
async function assertPlanInScope(id: number): Promise<{ error: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return { error: "Plan not found." };

  const rows = await db
    .select({ branchId: membershipPlans.branchId })
    .from(membershipPlans)
    .where(eq(membershipPlans.id, id))
    .limit(1);

  if (rows.length === 0) return { error: "Plan not found." };
  if (!(await isBranchInScope(rows[0].branchId))) {
    return { error: "Plan not found." };
  }
  return null;
}

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
export async function updatePlanAction(
  id: number,
  formData: FormData
): Promise<PlanActionResult> {
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
    const outOfScope = await assertPlanInScope(id);
    if (outOfScope) return outOfScope;

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
export async function togglePlanActiveAction(
  id: number,
  isActive: boolean
): Promise<PlanActionResult> {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can toggle plans." };
  }

  try {
    const outOfScope = await assertPlanInScope(id);
    if (outOfScope) return outOfScope;

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