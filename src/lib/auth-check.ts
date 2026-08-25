/**
 * Centralized authentication + authorization helpers
 *
 * The session is a single signed JWT cookie (see lib/session.ts).
 * Forged cookies fail signature verification and are treated as logged out.
 * Identity is resolved by user id (the session `sub`), NOT by display name,
 * so two users with the same display name can never impersonate each other.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUsers, StaffPermissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySessionToken, SESSION_COOKIE, type SessionPayload } from "@/lib/session";

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
 */
export async function getVerifiedRole(): Promise<Role | null> {
  const session = await getSession();
  if (!session) return null;

  // Env-based owner: full access, always valid (subject = "owner")
  if (session.sub === "owner") {
    return session.role === "owner" ? "owner" : null;
  }

  // DB user: verify the account still exists and is active (a user who was
  // deactivated or deleted should lose access immediately).
  try {
    const users = await db
      .select({ id: appUsers.id, role: appUsers.role, isActive: appUsers.isActive })
      .from(appUsers)
      .where(eq(appUsers.id, Number(session.sub)))
      .limit(1);

    if (users.length === 0 || !users[0].isActive) return null;
    return users[0].role as Role;
  } catch (e) {
    console.error("Auth check failed:", e);
    return null;
  }
}

/**
 * Get the full current user object (with branchId + permissions).
 * Returns null if not logged in.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
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
}

/**
 * Enforce that the user is logged in as OWNER.
 */
export async function requireOwner() {
  const role = await getVerifiedRole();
  if (role !== "owner") {
    redirect("/admin/members");
  }
}

/**
 * Enforce that the user is logged in (owner OR staff).
 */
export async function requireAuthenticated(): Promise<Role> {
  const role = await getVerifiedRole();
  if (!role) {
    redirect("/login");
  }
  return role;
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
