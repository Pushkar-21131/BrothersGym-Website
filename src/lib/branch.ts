/**
 * Central branch context helpers.
 * Every server action + admin page should use these to know
 * WHICH branch's data to query/modify.
 */

import { cookies } from "next/headers";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth-check";

export type BranchScope =
  | { type: "all"; branchIds: number[] } // owner viewing all
  | { type: "single"; branchId: number; branchCode: string; branchName: string };

/**
 * Get all active branches from DB.
 */
export async function getAllBranches() {
  return await db
    .select()
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(branches.id);
}

/**
 * Get the branch(es) the current user is allowed to see.
 *
 * - Owner + cookie "all" → all branches (BranchScope.type="all")
 * - Owner + cookie has branchId → single branch view
 * - Staff → always locked to their assigned branch
 * - Not authenticated → throws
 */
export async function getBranchScope(): Promise<BranchScope> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const cookieStore = await cookies();
  const activeBranchCookie = cookieStore.get("admin_branch")?.value;

  // ===== STAFF: Locked to their assigned branch =====
  if (user.role === "staff") {
    if (!user.branchId) {
      throw new Error(
        "Your staff account is not assigned to a branch. Contact the owner."
      );
    }

    const branchRow = await db
      .select()
      .from(branches)
      .where(eq(branches.id, user.branchId))
      .limit(1);

    if (branchRow.length === 0) throw new Error("Assigned branch not found");

    return {
      type: "single",
      branchId: branchRow[0].id,
      branchCode: branchRow[0].code,
      branchName: branchRow[0].name,
    };
  }

  // ===== OWNER =====
  const allBranches = await getAllBranches();

  // Owner viewing "all" (default or explicit)
  if (!activeBranchCookie || activeBranchCookie === "all") {
    return {
      type: "all",
      branchIds: allBranches.map((b) => b.id),
    };
  }

  // Owner viewing a specific branch
  const activeBranchId = Number(activeBranchCookie);
  const branch = allBranches.find((b) => b.id === activeBranchId);

  if (!branch) {
    // Fallback to all if cookie is invalid
    return { type: "all", branchIds: allBranches.map((b) => b.id) };
  }

  return {
    type: "single",
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
  };
}

/**
 * For actions that MUST have a single branch (like INSERT).
 * If owner is in "all" mode, they must explicitly pass a branchId.
 */
export async function requireSingleBranch(
  fallbackBranchId?: number
): Promise<{ branchId: number; branchCode: string; branchName: string }> {
  const scope = await getBranchScope();

  if (scope.type === "single") {
    return {
      branchId: scope.branchId,
      branchCode: scope.branchCode,
      branchName: scope.branchName,
    };
  }

  // Owner in "all" mode — must have a fallback
  if (fallbackBranchId) {
    const branchRow = await db
      .select()
      .from(branches)
      .where(eq(branches.id, fallbackBranchId))
      .limit(1);

    if (branchRow.length === 0)
      throw new Error("Invalid branch selected");

    return {
      branchId: branchRow[0].id,
      branchCode: branchRow[0].code,
      branchName: branchRow[0].name,
    };
  }

  throw new Error(
    "Please select a branch first (you are in 'All Branches' view)."
  );
}

/**
 * Set the active branch cookie (owner only).
 */
export async function setActiveBranchCookie(branchIdOrAll: number | "all") {
  const cookieStore = await cookies();
  cookieStore.set("admin_branch", String(branchIdOrAll), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
    sameSite: "lax",
  });
}