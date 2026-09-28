/**
 * Who may administer WHICH admin/staff login.
 *
 * WHY THIS IS SEPARATE AND WHY IT IS STRICT
 * User management is the one place where a branch-scoped owner could climb out
 * of their own branch. `assertOwner()` only proves the caller has the owner
 * role — a branch owner passes it. If that were the only gate, the NR owner
 * could:
 *
 *   - create a second owner login with no branch assigned (= super-admin) and
 *     log into it, seeing both gyms;
 *   - reset the SP owner's password and take over their account;
 *   - deactivate the SP owner, or move SP's staff into NR.
 *
 * So every write against `app_users` goes through here. The rules:
 *
 *   super-admin (owner, no branch)  → may administer anyone.
 *   branch owner (owner + branch)   → may administer STAFF in their OWN branch
 *                                     only, and may never create or edit an
 *                                     owner-role login, nor set/clear branch_id.
 *   staff                           → never (callers assertOwner first anyway).
 *
 * Lives in its own module rather than in auth-check.ts because it needs
 * getBranchScope(), and branch.ts already imports auth-check.ts — putting it
 * there would be an import cycle.
 */

import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "./auth-check";
import { getBranchScope, isSuperAdmin } from "./branch";

export type Denial = { error: string };

/**
 * Guard for editing/deleting an EXISTING login.
 *
 * Returns a Denial to return straight to the client, or null when allowed. The
 * message is identical for "no such user" and "not yours" so the other gym's
 * user ids cannot be enumerated.
 */
export async function assertCanAdministerUser(
  targetUserId: number
): Promise<Denial | null> {
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return { error: "User not found." };
  }

  if (await isSuperAdmin()) return null;

  const rows = await db
    .select({ id: appUsers.id, role: appUsers.role, branchId: appUsers.branchId })
    .from(appUsers)
    .where(eq(appUsers.id, targetUserId))
    .limit(1);

  if (rows.length === 0) return { error: "User not found." };
  const target = rows[0];

  // A branch owner must not touch any owner login — including their own, since
  // editing it is how they would clear their own branch and become global.
  if (target.role === "owner") {
    return {
      error:
        "Owner logins are managed by the main owner account. You can add and edit staff for your own gym.",
    };
  }

  const scope = await getBranchScope();
  const myBranchId = scope.type === "single" ? scope.branchId : null;
  if (myBranchId === null || target.branchId !== myBranchId) {
    return { error: "User not found." };
  }

  return null;
}

/**
 * Guard for CREATING a login, and for any edit that changes role or branch.
 *
 * `branchId` is what the caller is asking for. A branch owner may only ask for
 * staff in their own branch; anything else is a privilege escalation attempt or
 * a mistake, and both should fail loudly.
 */
export async function assertCanAssignRoleAndBranch(
  role: "owner" | "staff",
  branchId: number | null
): Promise<Denial | null> {
  if (await isSuperAdmin()) return null;

  const user = await getCurrentUser();
  if (!user || user.role !== "owner") {
    return { error: "Only an owner can manage logins." };
  }

  if (role === "owner") {
    return {
      error:
        "Only the main owner account can create or change owner logins. You can add staff for your own gym.",
    };
  }

  const scope = await getBranchScope();
  const myBranchId = scope.type === "single" ? scope.branchId : null;

  if (myBranchId === null) {
    return { error: "Your account is not assigned to a branch." };
  }

  if (branchId !== myBranchId) {
    return { error: "You can only add staff to your own gym." };
  }

  return null;
}

/**
 * The branch a non-super-admin owner is forced to use, so a tampered form field
 * cannot place a staff login in the other gym. Null for the super-admin, who
 * chooses freely.
 */
export async function forcedBranchIdForCaller(): Promise<number | null> {
  if (await isSuperAdmin()) return null;
  const scope = await getBranchScope();
  return scope.type === "single" ? scope.branchId : null;
}

/**
 * Guard against a change that would leave nobody able to administer logins.
 *
 * `assertCanAdministerUser` answers "is this login yours to touch". This answers
 * a different question: "if you touch it, can anyone still get back in".
 *
 * Owner logins are the only way into /admin/users, so removing the last one
 * removes the ability to create logins at all — there is no screen to undo it
 * from. The env bootstrap owner (ADMIN_EMAIL/ADMIN_PASSWORD) is the one way
 * back in, but the password-reset flow explicitly tells the operator to remove
 * ADMIN_PASSWORD once a row exists for that address, so it is not something to
 * design around.
 *
 * Only ACTIVE owner logins count. An inactive row cannot be signed into
 * (verifyOwnerCredentials filters on isActive), so it is not a way back in.
 *
 * `targetStaysActiveOwner` is the state the caller intends for the target after
 * their change: false when deleting, and the submitted `isActive` when editing.
 * When it is true nothing is being removed and the check is skipped — which is
 * what keeps an unrelated edit of an already-inactive owner login from being
 * refused.
 */
export async function assertOwnerRemains(
  targetUserId: number,
  targetStaysActiveOwner: boolean
): Promise<Denial | null> {
  if (targetStaysActiveOwner) return null;

  const rows = await db
    .select({ role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.id, targetUserId))
    .limit(1);

  // Not an owner, or already gone. Nothing to protect.
  if (rows.length === 0 || rows[0].role !== "owner") return null;

  const owners = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.role, "owner"), eq(appUsers.isActive, true)));

  if (owners.filter((o) => o.id !== targetUserId).length === 0) {
    return {
      error:
        "This is the only active owner login. Removing it would leave nobody able to manage logins, and there is no way back in from this site. Create or activate another owner login first.",
    };
  }

  return null;
}

/**
 * Guard against a caller removing their own access by accident.
 *
 * getVerifiedRole() re-reads app_users on every request and returns null once
 * the row is gone or inactive, so this does not need to sign anyone out — the
 * very next page load does it. The problem is that it happens with no warning,
 * mid-session, from a button that looks like it is about someone else.
 */
export async function assertNotSelf(targetUserId: number): Promise<Denial | null> {
  const me = await getCurrentUser();

  // me.id is null for the env bootstrap owner, who has no row and therefore
  // cannot be the target of a delete or an update here.
  if (me && me.id !== null && me.id === targetUserId) {
    return {
      error:
        "You cannot remove the login you are signed in with. Sign in as another owner first.",
    };
  }

  return null;
}
