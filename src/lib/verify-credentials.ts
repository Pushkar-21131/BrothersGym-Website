import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

export type OwnerIdentity = {
  /** "owner" for the env-based owner, or the appUsers id as a string. */
  subject: string;
  name: string;
  branchId: number | null;
};

/**
 * Check an owner email + password pair.
 *
 * Lives in a plain lib module (not a "use server" file) on purpose: every export
 * of a "use server" module becomes a publicly callable server action, and this
 * must only ever be reachable through the actions that gate it.
 *
 * Order matters. An owner row in app_users is authoritative when it exists, and
 * ADMIN_PASSWORD is only the bootstrap credential used until one does. Checking
 * env first would mean a password reset (which writes a row for ADMIN_EMAIL)
 * left the old ADMIN_PASSWORD working forever alongside the new password.
 *
 * Returns the identity to log in as, or null if the credentials are wrong.
 */
export async function verifyOwnerCredentials(
  email: string,
  password: string
): Promise<OwnerIdentity | null> {
  try {
    const users = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.email, email), eq(appUsers.isActive, true)))
      .limit(1);

    if (users.length > 0 && users[0].role === "owner") {
      const ok = await bcrypt.compare(password, users[0].passwordHash);
      // Authoritative either way — do not fall through to the env password.
      if (!ok) return null;
      return {
        subject: String(users[0].id),
        name: users[0].name,
        branchId: users[0].branchId,
      };
    }
  } catch (e) {
    // A database outage falls through to the env credential below rather than
    // locking the owner out of their own admin panel.
    console.error("Owner credential check failed:", e);
  }

  // Bootstrap owner: used until an owner row exists in app_users.
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return null;

  if (email === adminEmail && password === adminPassword) {
    return { subject: "owner", name: "Owner", branchId: null };
  }

  return null;
}
