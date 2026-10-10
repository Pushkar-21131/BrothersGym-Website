"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUsers, branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  checkRateLimit,
  checkAccountRateLimit,
  checkDailyEmailCap,
  accountRateLimitKey,
  resetRateLimit,
  logLoginAttempt,
  getClientInfo,
} from "@/lib/security";
import { assertOwner } from "@/lib/auth-check";
import { isSuperAdmin } from "@/lib/branch";
import {
  assertCanAdministerUser,
  assertCanAssignRoleAndBranch,
  assertNotSelf,
  assertOwnerRemains,
  forcedBranchIdForCaller,
} from "@/lib/user-admin";
import { sanitizeError } from "@/lib/errors";
import { sendSecurityAlert } from "@/app/actions/security-alerts";
import { verifyTurnstile } from "@/lib/turnstile";
import { validatePassword } from "@/lib/password";
import { verifyOwnerCredentials, verifyStaffCredentials } from "@/lib/verify-credentials";
import { issueLoginCode, verifyLoginOTP } from "@/lib/otp-codes";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session";

export type AuthRole = "owner" | "staff";

const MAX_ATTEMPTS = 5;

/**
 * Set the signed session cookie plus `admin_branch` (the switchable active
 * branch).
 *
 * No `last_activity` cookie: the idle timer used to read one, and a cookie the
 * client can delete is a check the client can skip. The timestamp now rides
 * inside the signed token as `iat`, which the middleware re-stamps on every
 * admin request — see section 1 of src/middleware.ts.
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

  // Second, account-keyed bound — see checkAccountRateLimit. The IP limiter
  // above is defeated by rotating IPs, which is cheap; the account is the part
  // of the request an attacker cannot change, because naming it is the whole
  // attack. Both have to pass. Skipped when no address was submitted, since an
  // empty account would put every such request in one shared bucket — a way to
  // lock out unrelated callers rather than a way to slow an attacker down.
  if (emailLower) {
    const accountLimit = await checkAccountRateLimit("login", emailLower);
    if (!accountLimit.allowed) {
      await logLoginAttempt({
        email: emailLower,
        success: false,
        reason: "rate-limited",
      });
      return {
        error: `Too many failed attempts. Try again in ${accountLimit.blockMinutesLeft} minutes.`,
      };
    }
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
  await resetRateLimit(accountRateLimitKey("login", emailLower));
  await logLoginAttempt({ email: emailLower, success: true });
  await setAuthCookies("owner", identity.subject, identity.name, identity.branchId);
  redirect("/admin");
}

// ===== STAFF LOGIN (step 1 of the OTP flow) =====
/**
 * Start a staff login: check the password, then email a 6-digit code.
 *
 * The staff half of sendLoginOTP, and it shares the `login:` rate-limit buckets
 * with the owner flow, so attempts against either door count toward one block.
 * Credentials are verified before anything is emailed, so a wrong password
 * cannot be used to make the site send mail or to confirm an address exists.
 */
export async function staffLoginAction(
  email: string,
  password: string,
  deviceInfo: string,
  captchaToken: string
) {
  const emailLower = String(email || "").trim().toLowerCase();
  const { ip } = await getClientInfo();

  const rateLimit = await checkRateLimit(`login:${ip}`);
  if (!rateLimit.allowed) {
    await logLoginAttempt({ email: emailLower, success: false, reason: "rate-limited" });
    return {
      error: `Too many failed attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  // Same account-keyed bound as the owner flow — see checkAccountRateLimit.
  // Guarded on a non-empty address for the same reason as there.
  if (emailLower) {
    const accountLimit = await checkAccountRateLimit("login", emailLower);
    if (!accountLimit.allowed) {
      await logLoginAttempt({ email: emailLower, success: false, reason: "rate-limited" });
      return {
        error: `Too many failed attempts. Try again in ${accountLimit.blockMinutesLeft} minutes.`,
      };
    }
  }

  // The Turnstile token is single-use, so this is the only step that can redeem
  // it — step 2 carries no captcha, exactly as on the owner flow.
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    await logLoginAttempt({ email: emailLower, success: false, reason: "captcha-failed" });
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  if (!emailLower || !password) {
    return { error: "Email and password are required." };
  }

  const check = await verifyStaffCredentials(emailLower, password);

  if (check.status === "error") {
    return { error: "Server error. Try again." };
  }

  if (check.status === "invalid") {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "wrong-credentials",
    });
    const attemptsLeft = rateLimit.remainingAttempts || 0;
    const warning =
      attemptsLeft <= 2 ? ` (${attemptsLeft} attempts left before block)` : "";
    return { error: `Invalid staff email or password.${warning}` };
  }

  // The password is verified from here on, so the account-shape problems can be
  // named: whoever is reading this already holds valid credentials, so neither
  // message leaks anything to an attacker, while a real staff member finally
  // gets told what is actually wrong.
  if (check.status === "not-staff") {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "not-staff-account",
    });
    return { error: "This login is for staff only. Please use the owner login." };
  }

  if (check.status === "no-branch") {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "no-branch-assigned",
    });
    return {
      error: "Your account is not assigned to a branch. Contact the owner.",
    };
  }

  // Per-address daily cap — same reasoning as on the owner flow. The IP limit
  // above is rotatable, this one is not, and the password is known good by now,
  // so this exists to stop a leaked password being spent on exhausting the
  // Resend quota rather than to slow down guessing.
  const cap = await checkDailyEmailCap(emailLower);
  if (!cap.allowed) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "daily-email-cap",
    });
    return {
      error: `Too many login codes requested for this address. Try again in ${cap.hoursLeft} hours.`,
    };
  }

  // A staff member's code goes to their own address. There is no forwarding
  // address for them the way OWNER_EMAIL forwards for the owner — that exists
  // so the admin address can stay out of the owner's daily inbox, and staff
  // sign in with the address the owner created for them in the first place.
  const sent = await issueLoginCode({
    email: emailLower,
    recipient: emailLower,
    deviceInfo,
  });
  if (sent.error) return { error: sent.error };

  return { otpSent: true as const };
}

// ===== STAFF LOGIN (step 2 of the OTP flow) =====
/**
 * Finish the staff login started by staffLoginAction.
 *
 * No captcha check: the Turnstile token was single-use and was already redeemed
 * in step 1. Credentials are re-verified so a valid code on its own is useless
 * — the code and the password each have to be right in the same request.
 */
export async function completeStaffLogin(
  email: string,
  password: string,
  otp: string
) {
  const emailLower = String(email || "").trim().toLowerCase();
  const { ip } = await getClientInfo();

  const rateLimit = await checkRateLimit(`login:${ip}`);
  if (!rateLimit.allowed) {
    await logLoginAttempt({ email: emailLower, success: false, reason: "rate-limited" });
    return {
      error: `Too many failed attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  if (emailLower) {
    const accountLimit = await checkAccountRateLimit("login", emailLower);
    if (!accountLimit.allowed) {
      await logLoginAttempt({ email: emailLower, success: false, reason: "rate-limited" });
      return {
        error: `Too many failed attempts. Try again in ${accountLimit.blockMinutesLeft} minutes.`,
      };
    }
  }

  const check = await verifyStaffCredentials(emailLower, password);

  // not-staff and no-branch collapse into the generic reply here: step 1 already
  // reported them specifically, so the only way to be in this branch is to have
  // changed the submitted credentials between the two steps.
  if (check.status !== "ok") {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: check.status === "error" ? "server-error" : "wrong-credentials",
    });
    return { error: "Invalid staff email or password." };
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
  await resetRateLimit(accountRateLimitKey("login", emailLower));
  await logLoginAttempt({ email: emailLower, success: true });
  await setAuthCookies("staff", String(check.id), check.name, check.branchId);
  redirect("/admin/members");
}

// ===== LOGOUT =====
/**
 * Clear every session cookie. Does NOT navigate — the caller does, with a full
 * page load.
 *
 * `set(name, "", { maxAge: 0 })` rather than `delete()`: delete() emits a
 * Set-Cookie carrying only Path, while the session it is replacing is HttpOnly,
 * SameSite=lax and — in production — Secure. Writing the clear with the same
 * attributes means the browser sees one cookie being replaced, not two
 * differently-marked cookies of the same name.
 *
 * Nothing writes `last_activity` any more (the idle timer moved into the signed
 * token), but browsers from before that change still hold one, and the plaintext
 * `admin_*` cookies predate the signed session entirely.
 */
export async function logoutAction() {
  const cookieStore = await cookies();
  const gone = { ...sessionCookieOptions(), maxAge: 0 };

  for (const name of [
    SESSION_COOKIE,
    "admin_branch",
    "last_activity",
    "admin_token",
    "admin_role",
    "admin_name",
  ]) {
    cookieStore.set(name, "", gone);
  }
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
/**
 * What every staff-login action returns.
 *
 * WRITTEN OUT RATHER THAN INFERRED, ON PURPOSE.
 * TypeScript normalizes a union built from several `return` statements by adding
 * each missing key back as an optional `?: undefined` member. The inferred type
 * here was
 *
 *   { error: string; success?: undefined } | { success: boolean; error?: undefined }
 *
 * and on that, `if ("error" in r)` narrows nothing — `error` is *declared* on
 * both arms, so the `in` check is satisfied by both. The callers in
 * admin/users/staff-logins-client.tsx use exactly that check, so `r.error` came
 * back as `string | undefined` and `toast.error(r.error)` stopped compiling.
 *
 * Declaring the union keeps `error` present on one arm only, which is what makes
 * `"error" in r` a real discriminant.
 */
type UserAdminResult = { error: string } | { success: true };

export async function createStaffUserAction(
  formData: FormData
): Promise<UserAdminResult> {
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
export async function updateStaffUserAction(
  id: number,
  formData: FormData
): Promise<UserAdminResult> {
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

  // Switching a login OFF is the same loss of access as deleting it, so it gets
  // the same two guards. Without them the delete guards below would be trivially
  // bypassed by unticking this box instead of pressing Delete — the users screen
  // offers both, and the outcome is identical.
  if (!isActive) {
    const self = await assertNotSelf(id);
    if (self) return self;
    const lastOwner = await assertOwnerRemains(id, false);
    if (lastOwner) return lastOwner;
  }

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
export async function deleteStaffUserAction(
  id: number
): Promise<UserAdminResult> {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can delete staff logins." };
  }

  try {
    const denied = await assertCanAdministerUser(id);
    if (denied) return denied;

    // Two ways this action can lock the gym out of its own admin panel. Both are
    // silent from the UI — the button looks like it acts on someone else — and
    // neither is recoverable from a screen inside the site.
    const self = await assertNotSelf(id);
    if (self) return self;

    const lastOwner = await assertOwnerRemains(id, false);
    if (lastOwner) return lastOwner;

    await db.delete(appUsers).where(eq(appUsers.id, id));
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete user") };
  }
}

// ===== UPDATE PERMISSIONS =====
// Deleted. There were two server actions writing the same `app_users.permissions`
// jsonb column: this one, which took the blob as given and wrote it with
// `permissions as any`, and `actions/permissions.ts:updatePermissionsAction`,
// which the permissions modal actually calls. Nothing referenced this one — but
// `"use server"` makes every export a real endpoint whether or not a page links
// to it, so an unused action is still a second, unvalidated door onto the column.
// The surviving one now runs the blob through `sanitizeStaffPermissions()`.