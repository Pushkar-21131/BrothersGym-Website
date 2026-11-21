/**
 * Centralized authentication + authorization helpers
 *
 * The session is a single signed JWT cookie (see lib/session.ts).
 * Forged cookies fail signature verification and are treated as logged out.
 * Identity is resolved by user id (the session `sub`), NOT by display name,
 * so two users with the same display name can never impersonate each other.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUsers, StaffPermissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySessionToken, SESSION_COOKIE, type SessionPayload } from "@/lib/session";
import { PERMISSION_MODULES } from "@/lib/permissions";

export type Role = "owner" | "staff";

export type CurrentUser = {
  id: number | null; // null for env-based owner
  name: string;
  role: Role;
  branchId: number | null; // null for owner
  permissions: StaffPermissions | null;
};

/**
 * Get the authenticated session payload (verifies the signed cookie).
 * Returns null if not logged in.
 */
async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/**
 * Get the currently authenticated user's role, verified from DB.
 *
 * Delegates the DB lookup to getCurrentUser rather than repeating it. The two
 * used to run the same `select ... from app_users where id = $1` independently,
 * and a single admin page calls both — so every page began with two identical
 * round trips to a database that is ~250ms away from the functions.
 */
export const getVerifiedRole = cache(async (): Promise<Role | null> => {
  const session = await getSession();
  if (!session) return null;

  // Env-based owner: full access, always valid (subject = "owner").
  //
  // The `session.role` test is deliberate and must stay ahead of the
  // getCurrentUser call below. getCurrentUser trusts `sub === "owner"` and
  // reports role "owner" whatever the token's own role field says, so routing
  // this branch through it would quietly upgrade a token that claims some other
  // role. This is the stricter of the two checks, so it decides here.
  if (session.sub === "owner") {
    return session.role === "owner" ? "owner" : null;
  }

  // DB user: getCurrentUser re-checks the account still exists and is active,
  // so a user who was deactivated or deleted loses access immediately.
  return (await getCurrentUser())?.role ?? null;
});

/**
 * Get the full current user object (with branchId + permissions).
 * Returns null if not logged in.
 *
 * Memoised per request with React's cache(). This is the single hottest query
 * in the admin: hasPermission, getHiddenFields and getBranchScope each call it,
 * and the members page calls all three — plus getVerifiedRole, which now
 * delegates here too. Unmemoised that was six or seven identical `app_users`
 * lookups per page render, each a separate round trip to a database in a
 * different region from the functions. The admin's "slow page switching" was
 * mostly this: the same row read over and over, ~250ms at a time.
 *
 * Per-request is the right scope. Nothing here is cached across users or
 * across requests — a deactivated account still loses access on its very next
 * request, which is what the checks above and below depend on.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;

  // Env-based owner: full access, no branch restriction
  if (session.sub === "owner") {
    return {
      id: null,
      name: session.name,
      role: "owner",
      branchId: null,
      permissions: null, // Owner has all permissions implicitly
    };
  }

  // DB user
  try {
    const users = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, Number(session.sub)))
      .limit(1);

    if (users.length === 0 || !users[0].isActive) return null;

    const u = users[0];
    return {
      id: u.id,
      name: u.name,
      role: u.role as Role,
      branchId: u.branchId,
      permissions: (u.permissions as StaffPermissions) || null,
    };
  } catch (e) {
    console.error("getCurrentUser failed:", e);
    return null;
  }
});

/**
 * Enforce that the user is logged in as OWNER.
 */
export async function requireOwner() {
  const role = await getVerifiedRole();
  if (role !== "owner") {
    redirect(await getFirstAllowedAdminPath());
  }
}

/**
 * Throws if not owner (for server actions).
 */
export async function assertOwner() {
  const role = await getVerifiedRole();
  if (role !== "owner") {
    throw new Error("Unauthorized: owner access required");
  }
}

export async function assertAuthenticated(): Promise<Role> {
  const role = await getVerifiedRole();
  if (!role) {
    throw new Error("Unauthorized: authentication required");
  }
  return role;
}

/**
 * Check if a user has a specific permission.
 * Owners always return true.
 *
 * Example:
 *   await hasPermission("members", "canEdit")
 *   await hasPermission("reminders", "canSendSMS")
 */
export async function hasPermission(
  module: keyof StaffPermissions,
  action: string
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  // Owner has everything
  if (user.role === "owner") return true;

  const modulePerms = user.permissions?.[module] as
    | Record<string, boolean | string[]>
    | undefined;

  if (!modulePerms) return false;

  return Boolean(modulePerms[action]);
}

/**
 * Get the list of fields a staff member should NOT see.
 * Returns empty array for owner or if no restrictions.
 */
export async function getHiddenFields(
  module: keyof StaffPermissions
): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user || user.role === "owner") return [];

  const modulePerms = user.permissions?.[module] as
    | { hiddenFields?: string[] }
    | undefined;

  return modulePerms?.hiddenFields || [];
}

/**
 * Any action at all granted for this module. Owners always true.
 *
 * The page gate for a module that can be used add-only: an account that may
 * write but not browse still has a page to write on.
 */
export async function hasAnyModuleAction(
  module: keyof StaffPermissions
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (user.role === "owner") return true;

  const modulePerms = user.permissions?.[module] as
    | Record<string, boolean | string[]>
    | undefined;
  if (!modulePerms) return false;

  const actions =
    PERMISSION_MODULES.find((m) => m.key === module)?.actions ?? [];

  return actions.some((a) => modulePerms[a.key] === true);
}

/**
 * Whether this account may open the module's admin page at all.
 *
 * For most modules that is canView — the page is a list, and the list is the
 * whole of it. A module flagged `allowAddOnly` also opens for an account that
 * may only write; its page scopes itself to the rows that account created.
 *
 * This is the ONE predicate for that question. It is read by the page guards,
 * by the sidebar and by getFirstAllowedAdminPath below, because a nav link that
 * shows for a page that then redirects is a redirect loop.
 */
export async function hasModulePageAccess(
  module: keyof StaffPermissions
): Promise<boolean> {
  const mod = PERMISSION_MODULES.find((m) => m.key === module);
  if (mod?.allowAddOnly) return hasAnyModuleAction(module);
  return hasPermission(module, "canView");
}

/**
 * The first admin page this account may open. Every guard that cannot show
 * itself redirects here rather than naming another page — two pages naming each
 * other is what left a permissionless account bouncing on a blank shell.
 *
 * Each test below must equal its page's own gate, or the page refuses the path
 * this returns and the loop is back. So /admin (owner-only), /admin/security
 * (also isSuperAdmin) and /admin/reviews (also brand-content branch) are out.
 */
export async function getFirstAllowedAdminPath(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/login";
  if (user.role === "owner") return "/admin";

  const candidates: Array<[keyof StaffPermissions, string]> = [
    ["members", "/admin/members"],
    ["enquiries", "/admin/enquiries"],
    ["reminders", "/admin/reminders"],
    ["equipment", "/admin/equipment"],
    ["staff", "/admin/staff"],
    ["trainers", "/admin/trainers"],
    ["import", "/admin/import"],
  ];

  for (const [mod, path] of candidates) {
    if (await hasModulePageAccess(mod)) return path;
  }
  return "/admin/no-access";
}

/**
 * Enforce a permission check (throw if missing).
 */
export async function assertPermission(
  module: keyof StaffPermissions,
  action: string
) {
  const ok = await hasPermission(module, action);
  if (!ok) {
    throw new Error(
      `Permission denied: you don't have '${action}' access to '${module}'.`
    );
  }
}
