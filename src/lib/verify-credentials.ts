import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";

export type OwnerIdentity = {
  /** "owner" for the env-based owner, or the appUsers id as a string. */
  subject: string;
  name: string;
  branchId: number | null;
};

/**
 * A real cost-10 bcrypt hash used as a decoy when the submitted email matches
 * no active user. Comparing the password against this (instead of skipping the
 * check) keeps the response time the same whether or not the email exists, so
 * timing can't be used to enumerate accounts. It matches no real password —
 * bcryptjs also short-circuits on a malformed hash, so this must stay a
 * well-formed hash of the same cost as real user hashes (see bcrypt.hash(…, 10)).
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$5IwIbSl6wdqwjjeNK1YI8OItXCbiPQvs/82rRBgkZ0Rw1giKkI4Q2";

/**
 * What checking a staff email + password produced.
 *
 * The three failures are separated because, by the time any of them can be
 * returned, the password has already been verified — so whoever is asking
 * holds valid credentials and the specific message leaks nothing, while a real
 * staff member finally gets told what is actually wrong. Anything that fails
 * BEFORE the password check collapses to "invalid", which is what keeps the
 * reply for an unknown address and a wrong password identical.
 */
export type StaffCredentialCheck =
  | { status: "ok"; id: number; name: string; branchId: number }
  | { status: "not-staff" }
  | { status: "no-branch" }
  | { status: "invalid" }
  | { status: "error" };

/**
 * Constant-time comparison of two strings.
 *
 * `a === b` stops at the first differing character, so the time it takes to
 * reject leaks how many leading characters were right — enough, over many
 * attempts, to walk a value out one character at a time. That matters here
 * because `adminPassword` is compared directly.
 *
 * Both sides are hashed to a fixed 32 bytes rather than length-checked first.
 * The webhook's `signatureMatches` (api/webhooks/razorpay/[branch]/route.ts)
 * does check length first, because both sides there are hex digests of known
 * size so there is no length to hide. A password has no fixed size, and a
 * "return false if the lengths differ" guard leaks its exact length — which is
 * most of the work in a brute force. Hashing first removes that, and it also
 * means timingSafeEqual is never handed mismatched buffers (it throws on them).
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

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

  // Both halves are evaluated up front so the `&&` cannot short-circuit on the
  // email: otherwise a caller could tell "email matched, password didn't" from
  // "email didn't match" by response time alone. The admin address is not
  // secret, but there is no reason to answer the question.
  const emailMatches = safeEqual(email, adminEmail);
  const passwordMatches = safeEqual(password, adminPassword);

  if (emailMatches && passwordMatches) {
    return { subject: "owner", name: "Owner", branchId: null };
  }

  return null;
}

/**
 * Check a staff email + password pair, and report the account shape once the
 * password is known good.
 *
 * The staff counterpart of verifyOwnerCredentials, and in this module for the
 * same reason: every export of a "use server" file is a publicly callable
 * server action, and this must only be reachable through the login action that
 * gates it.
 *
 * Deliberately does NOT fall back to ADMIN_EMAIL/ADMIN_PASSWORD the way the
 * owner check does. Those credentials are the super-admin's; accepting them
 * here would let the owner sign in through the staff door and get a
 * branch-scoped session instead of their own.
 */
export async function verifyStaffCredentials(
  email: string,
  password: string
): Promise<StaffCredentialCheck> {
  let user: typeof appUsers.$inferSelect | null = null;
  try {
    const users = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.email, email), eq(appUsers.isActive, true)))
      .limit(1);
    if (users.length > 0) user = users[0];
  } catch (e) {
    console.error("Staff credential lookup failed:", e);
    return { status: "error" };
  }

  // Always run bcrypt — against the real hash if the user exists, otherwise the
  // decoy — so a missing/inactive email and a wrong password cost the same time.
  let passwordOk = false;
  try {
    passwordOk = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
  } catch (e) {
    console.error("bcrypt error:", e);
    return { status: "error" };
  }

  if (!user || !passwordOk) return { status: "invalid" };

  if (user.role !== "staff") return { status: "not-staff" };
  if (!user.branchId) return { status: "no-branch" };

  return { status: "ok", id: user.id, name: user.name, branchId: user.branchId };
}
