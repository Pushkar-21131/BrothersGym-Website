/**
 * Central branch context helpers.
 * Every server action + admin page should use these to know
 * WHICH branch's data to query/modify.
 *
 * ============================================================
 * PER-BRANCH OWNER ISOLATION
 * ============================================================
 * The two branches have different owners, so each owner sees and edits only
 * their own gym. The switch is `app_users.branch_id`:
 *
 *   owner, branch_id = NULL  → SUPER-ADMIN. Sees every branch, can switch
 *                              between them, curates brand-wide content.
 *                              The env-var login (ADMIN_EMAIL) is always this.
 *   owner, branch_id = <id>  → BRANCH OWNER. Locked to that one branch, exactly
 *                              like staff, but with full owner powers inside it.
 *   staff, branch_id = <id>  → unchanged; locked, with granular permissions.
 *
 * WHY branch_id AND NOT A NEW ROLE OR FLAG
 * This is what makes the change trivially reversible, which was a requirement.
 * To hand an owner back the old all-branches access you clear their branch in
 * Admin → Users and they are global again on their next request: no code change,
 * no migration, no redeploy. A new "branch_owner" role would have needed a
 * migration to undo, and a boolean flag would have been a second thing to keep
 * in sync with branch_id.
 *
 * The second, coarser undo is BRANCH_SCOPED_OWNERS=false, which ignores
 * branch_id for owners entirely and restores the pre-change behaviour for
 * everyone at once. See scopedOwnersEnabled() below.
 */

import { cookies } from "next/headers";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, hasPermission } from "./auth-check";

export type BranchScope =
  | { type: "all"; branchIds: number[] } // super-admin viewing all
  | { type: "single"; branchId: number; branchCode: string; branchName: string };

/**
 * Master switch for per-branch owner isolation. On unless explicitly disabled.
 *
 * Set BRANCH_SCOPED_OWNERS=false to give every owner the all-branches view
 * again regardless of their branch assignment — the whole-feature undo. Read at
 * request time, not module load, so it is not baked into the build.
 */
function scopedOwnersEnabled(): boolean {
  return (process.env.BRANCH_SCOPED_OWNERS || "").trim().toLowerCase() !== "false";
}

/**
 * Branch whose owner also curates brand-wide content — the homepage
 * testimonials, which are one shared pool for one shared website rather than
 * per-gym. Defaults to NR; override with BRAND_CONTENT_BRANCH_CODE.
 */
export const BRAND_CONTENT_BRANCH_CODE = (
  process.env.BRAND_CONTENT_BRANCH_CODE || "NR"
)
  .trim()
  .toUpperCase();

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
 * - Staff → always locked to their assigned branch
 * - Owner WITH a branch assigned → locked to it (unless BRANCH_SCOPED_OWNERS=false)
 * - Owner with NO branch assigned (super-admin) → all branches, or the one
 *   picked in the branch switcher
 * - Not authenticated → throws
 */
export async function getBranchScope(): Promise<BranchScope> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const cookieStore = await cookies();
  const activeBranchCookie = cookieStore.get("admin_branch")?.value;

  // ===== LOCKED TO ONE BRANCH =====
  // Staff always. Owners too, once they have a branch assigned — that is what
  // separates the two gyms' dashboards. The `admin_branch` cookie is ignored
  // here on purpose: a locked user must not be able to widen their own scope by
  // setting a cookie, and this is the single place that decides.
  const locked =
    user.role === "staff" || (scopedOwnersEnabled() && user.branchId !== null);

  if (locked) {
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

  // ===== SUPER-ADMIN =====
  const allBranches = await getAllBranches();

  // Viewing "all" (default or explicit)
  if (!activeBranchCookie || activeBranchCookie === "all") {
    return {
      type: "all",
      branchIds: allBranches.map((b) => b.id),
    };
  }

  // Viewing a specific branch
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
 * Is this the super-admin — an owner with no branch assignment?
 *
 * Distinct from `assertOwner()`, which only checks the ROLE and is therefore
 * true for a branch-scoped owner too. Use this for the handful of things that
 * are genuinely global: managing owner logins, the security/audit log, and
 * anything that spans both gyms.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return false;
  if (!scopedOwnersEnabled()) return true;
  return user.branchId === null;
}

/** Throws unless the caller is the super-admin. */
export async function assertSuperAdmin(): Promise<void> {
  if (!(await isSuperAdmin())) {
    throw new Error(
      "This is a group-wide setting — only the main owner account can change it."
    );
  }
}

/**
 * Is the caller's active scope the branch that curates brand-wide content?
 *
 * False for the super-admin in "All Branches" view — they are covered by
 * isSuperAdmin() instead, so check that first.
 */
export async function isBrandContentBranch(): Promise<boolean> {
  const scope = await getBranchScope();
  return (
    scope.type === "single" &&
    scope.branchCode.trim().toUpperCase() === BRAND_CONTENT_BRANCH_CODE
  );
}

/**
 * May the caller edit brand-wide content (homepage testimonials)?
 *
 * True for the super-admin, for the owner of BRAND_CONTENT_BRANCH_CODE, and for
 * staff in that same branch who have been granted reviews.canEdit. The reviews
 * pool feeds one shared public website, so it cannot be split per gym — but it
 * also must not be editable by both owners, or either could delete a review
 * praising the other's gym.
 */
export async function canManageBrandContent(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (await isSuperAdmin()) return true;

  if (!(await isBrandContentBranch())) return false;
  if (user.role === "owner") return true;

  // Staff keep the delegated reviews permission they already had, but only in
  // the branch that curates brand content.
  return hasPermission("reviews", "canEdit");
}

/** Throws unless the caller may edit brand-wide content. */
export async function assertBrandContentAccess(): Promise<void> {
  if (!(await canManageBrandContent())) {
    throw new Error(
      "Homepage reviews are shared across both gyms and are managed by the main owner account."
    );
  }
}

/**
 * Is a row belonging to `branchId` inside the caller's scope?
 *
 * The check every write against an existing row needs. `assertOwner()` proves
 * the caller is AN owner; it says nothing about WHOSE data they are touching,
 * and with two owners those are different questions.
 */
export async function isBranchInScope(branchId: number): Promise<boolean> {
  const scope = await getBranchScope();
  return scope.type === "all"
    ? scope.branchIds.includes(branchId)
    : scope.branchId === branchId;
}

/**
 * Throws if `branchId` is outside the caller's scope.
 *
 * `subject` names the thing in the error the user sees, e.g. "plan" →
 * "That plan belongs to another branch." Call sites deliberately return the
 * same message for a missing row as for an out-of-scope one, so this cannot be
 * used to probe which ids exist in the other gym.
 */
export async function assertBranchInScope(
  branchId: number,
  subject = "record"
): Promise<void> {
  if (!(await isBranchInScope(branchId))) {
    throw new Error(`That ${subject} belongs to another branch.`);
  }
}

/**
 * For actions that MUST have a single branch (like INSERT).
 * If the super-admin is in "all" mode, they must explicitly pass a branchId.
 *
 * Note for locked users (staff and branch owners) the fallback is ignored and
 * their own branch always wins — so a tampered form that posts the other
 * branch's id creates the row in the caller's own branch rather than the
 * other's.
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

  // Super-admin in "all" mode — must have a fallback
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
 * Set the active branch cookie (super-admin only).
 *
 * getBranchScope() already ignores this cookie for locked users, so a stale or
 * forged one cannot widen anybody's scope. Refusing here as well keeps the
 * switcher honest instead of appearing to work and silently doing nothing.
 */
export async function setActiveBranchCookie(branchIdOrAll: number | "all") {
  await assertSuperAdmin();

  const cookieStore = await cookies();
  cookieStore.set("admin_branch", String(branchIdOrAll), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
    sameSite: "lax",
  });
}
