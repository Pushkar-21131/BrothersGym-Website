"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUsers, branches } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  checkRateLimit,
  resetRateLimit,
  logLoginAttempt,
  getClientInfo,
} from "@/lib/security";
import { assertOwner } from "@/lib/auth-check";
import { isSuperAdmin } from "@/lib/branch";
import {
  assertCanAdministerUser,
  assertCanAssignRoleAndBranch,
  forcedBranchIdForCaller,
} from "@/lib/user-admin";
import { sanitizeError } from "@/lib/errors";
import { sendSecurityAlert } from "@/app/actions/security-alerts";
import { verifyTurnstile } from "@/lib/turnstile";
import { validatePassword } from "@/lib/password";
import { verifyOwnerCredentials } from "@/lib/verify-credentials";
import { verifyLoginOTP } from "@/app/actions/otp";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session";

export type AuthRole = "owner" | "staff";

const MAX_ATTEMPTS = 5;

// A real cost-10 bcrypt hash used as a decoy when the submitted email matches
// no active user. Comparing the password against this (instead of skipping the
// check) keeps the response time the same whether or not the email exists, so
// timing can't be used to enumerate accounts. It matches no real password —
// bcryptjs also short-circuits on a malformed hash, so this must stay a
// well-formed hash of the same cost as real user hashes (see bcrypt.hash(…, 10)).
const DUMMY_PASSWORD_HASH =
  "$2b$10$5IwIbSl6wdqwjjeNK1YI8OItXCbiPQvs/82rRBgkZ0Rw1giKkI4Q2";

/**
 * Set the signed session cookie plus the two supporting cookies
 * (admin_branch = switchable active branch, last_activity = idle timer).
 *
 * `subject` is "owner" for the env-based owner, or the appUsers id as a string.
 */
async function setAuthCookies(
  role: AuthRole,
  subject: string,
  name: string,
  branchId: number | null
) {
  const cookieStore = await cookies();
  const opts = sessionCookieOptions();

  const token = await createSessionToken({ sub: subject, role, name, branchId });
  cookieStore.set(SESSION_COOKIE, token, opts);
  cookieStore.set("last_activity", Date.now().toString(), opts);

  // An owner WITH a branch is scoped to it, so seed the cookie with that branch
  // rather than "all". getBranchScope() ignores this cookie for them either way;
  // keeping it honest just avoids a stale value surviving a role change.
  if (branchId) {
    cookieStore.set("admin_branch", String(branchId), {
      ...opts,
      maxAge: 60 * 60 * 24 * 30,
    });
  } else if (role === "owner") {
    cookieStore.set("admin_branch", "all", { ...opts, maxAge: 60 * 60 * 24 * 30 });
  }
}

// ===== OWNER LOGIN (step 2 of the OTP flow) =====
/**
 * Finish the owner login started by sendLoginOTP.
 *
 * There is deliberately no captcha check here: the Turnstile token is single-use
 * and was already redeemed in step 1. The second factor at this point is the
 * emailed OTP, and credentials are re-verified so a valid code alone is useless.
 */
export async function completeOwnerLogin(
  email: string,
  password: string,
  otp: string
) {
  const emailLower = String(email || "").trim().toLowerCase();
  const { ip } = await getClientInfo();

  const rateLimit = await checkRateLimit(`login:${ip}`);
  if (!rateLimit.allowed) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "rate-limited",
    });
    return {
      error: `Too many failed attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  // Credentials first, so a wrong password never consumes a valid OTP.
  const identity = await verifyOwnerCredentials(emailLower, password);
  if (!identity) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "wrong-credentials",
    });

    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
    if (emailLower === adminEmail) {
      await sendSecurityAlert({
        type: "failed-owner-login",
        email: emailLower,
        attempts: MAX_ATTEMPTS - (rateLimit.remainingAttempts || 0),
      });
    }

    const attemptsLeft = rateLimit.remainingAttempts || 0;
    const warning =
      attemptsLeft <= 2 ? ` (${attemptsLeft} attempts left before block)` : "";
    return { error: `Invalid owner email or password.${warning}` };
  }

  const otpResult = await verifyLoginOTP(emailLower, otp);
  if (otpResult.error) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "invalid-otp",
    });
    return { error: otpResult.error };
  }

  await resetRateLimit(`login:${ip}`);
  await logLoginAttempt({ email: emailLower, success: true });
  await setAuthCookies("owner", identity.subject, identity.name, identity.branchId);
  redirect("/admin");
}

// ===== STAFF LOGIN =====
export async function staffLoginAction(
  state: { error?: string } | null,
  formData: FormData
) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const { ip } = await getClientInfo();

  const rateLimit = await checkRateLimit(`login:${ip}`);
  if (!rateLimit.allowed) {
    await logLoginAttempt({ email, success: false, reason: "rate-limited" });
    return {
      error: `Too many failed attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  // ✅ Verify Cloudflare Turnstile captcha
  const captchaToken = String(formData.get("captchaToken") || "");
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    await logLoginAttempt({
      email,
      success: false,
      reason: "captcha-failed",
    });
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // One generic reply reused for a missing user AND a wrong password, so the
  // two are indistinguishable (no account enumeration via the error message).
  const attemptsLeft = rateLimit.remainingAttempts || 0;
  const genericWarning =
    attemptsLeft <= 2 ? ` (${attemptsLeft} attempts left before block)` : "";
  const invalidCredentials = {
    error: `Invalid staff email or password.${genericWarning}`,
  };

  let user: typeof appUsers.$inferSelect | null = null;
  try {
    const users = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.email, email), eq(appUsers.isActive, true)))
      .limit(1);

    if (users.length > 0) {
      user = users[0];
    }
  } catch (e) {
    console.error("DB staff login error:", e);
    return { error: "Server error. Try again." };
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
    return { error: "Server error verifying password. Try again." };
  }

  if (!user || !passwordOk) {
    await logLoginAttempt({
      email,
      success: false,
      reason: user ? "wrong-credentials" : "user-not-found",
    });
    return invalidCredentials;
  }

  // Password is now verified, so account-shape problems (wrong login form, no
  // branch) can be reported specifically: anyone reaching this point already
  // holds valid credentials, so these messages leak nothing to an attacker,
  // while a real user finally gets told what's actually wrong.
  if (user.role !== "staff") {
    await logLoginAttempt({
      email,
      success: false,
      reason: "not-staff-account",
    });
    return { error: "This login is for staff only. Please use the owner login." };
  }

  if (!user.branchId) {
    await logLoginAttempt({
      email,
      success: false,
      reason: "no-branch-assigned",
    });
    return {
      error: "Your account is not assigned to a branch. Contact the owner.",
    };
  }

  await resetRateLimit(`login:${ip}`);
  await logLoginAttempt({ email, success: true });
  await setAuthCookies("staff", String(user.id), user.name, user.branchId);

  redirect("/admin/members");
}

// ===== LOGOUT =====
export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete("admin_branch");
  cookieStore.delete("last_activity");
  // Remove any legacy plaintext auth cookies left from before the session fix.
  cookieStore.delete("admin_token");
  cookieStore.delete("admin_role");
  cookieStore.delete("admin_name");
  redirect("/");
}

// ===== SWITCH BRANCH =====
export async function switchBranchAction(branchIdOrAll: string) {
  // Main owner account only. getBranchScope() already ignores admin_branch for
  // anyone locked to a branch, so a forged cookie cannot widen a scope — but
  // refusing here too means the switcher never appears to work while silently
  // doing nothing.
  if (!(await isSuperAdmin())) {
    return { error: "Your account is set up for one gym, so there is nothing to switch." };
  }

  const cookieStore = await cookies();

  if (branchIdOrAll === "all") {
    cookieStore.set("admin_branch", "all", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
    });
    return { success: true, branchName: "All Branches" };
  }

  const branchId = Number(branchIdOrAll);
  if (!branchId) return { error: "Invalid branch" };

  try {
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0) return { error: "Branch not found" };

    cookieStore.set("admin_branch", String(branchId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
    });

    return { success: true, branchName: branch[0].name };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to switch branch") };
  }
}

// ===== CREATE STAFF USER =====
export async function createStaffUserAction(formData: FormData) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can create staff logins." };
  }

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "staff") as AuthRole;
  const branchIdRaw = formData.get("branchId");
  const branchId = branchIdRaw ? Number(branchIdRaw) : null;

  if (!name || !email || !password) return { error: "All fields are required" };
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return { error: passwordCheck.errors[0] };
  }
  if (!["owner", "staff"].includes(role)) return { error: "Invalid role" };
  if (role === "staff" && !branchId) return { error: "Staff must be assigned to a branch" };

  // A branch owner may only add staff to their own gym. Left ungated, they could
  // create an owner login with no branch — a super-admin — and log into it.
  const forced = await forcedBranchIdForCaller();
  const effectiveBranchId = forced ?? branchId;
  const denied = await assertCanAssignRoleAndBranch(role, effectiveBranchId);
  if (denied) return denied;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(appUsers).values({
      name,
      email,
      passwordHash,
      role,
      // An OWNER may now carry a branch: that is what scopes their dashboard to
      // one gym. NULL means all-branches (super-admin), which is also the undo —
      // clear the branch here and they are global again with no code change.
      branchId: effectiveBranchId,
      isActive: true,
    });
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to create user") };
  }
}

// ===== UPDATE STAFF USER =====
export async function updateStaffUserAction(id: number, formData: FormData) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update staff logins." };
  }

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const isActive = formData.get("isActive") === "true";
  const branchIdRaw = formData.get("branchId");
  const branchId = branchIdRaw ? Number(branchIdRaw) : null;

  if (!name || !email) return { error: "Name and email are required" };

  const denied = await assertCanAdministerUser(id);
  if (denied) return denied;

  // A branch owner cannot move a login into the other gym, and cannot clear a
  // branch (which would promote that account to super-admin).
  const forced = await forcedBranchIdForCaller();
  const effectiveBranchId = forced ?? branchId;

  try {
    const updateData: {
      name: string;
      email: string;
      isActive: boolean;
      branchId: number | null;
      passwordHash?: string;
    } = { name, email, isActive, branchId: effectiveBranchId };

    if (password && password.trim().length > 0) {
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        return { error: passwordCheck.errors[0] };
      }
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    await db.update(appUsers).set(updateData).where(eq(appUsers.id, id));
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update user") };
  }
}

// ===== DELETE STAFF USER =====
export async function deleteStaffUserAction(id: number) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can delete staff logins." };
  }

  try {
    const denied = await assertCanAdministerUser(id);
    if (denied) return denied;

    await db.delete(appUsers).where(eq(appUsers.id, id));
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete user") };
  }
}

// ===== UPDATE PERMISSIONS =====
export async function updateStaffPermissionsAction(
  userId: number,
  permissions: Record<string, unknown>
) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update permissions." };
  }

  try {
    const denied = await assertCanAdministerUser(userId);
    if (denied) return denied;

    await db
      .update(appUsers)
      .set({ permissions: permissions as any })
      .where(eq(appUsers.id, userId));
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update permissions") };
  }
}