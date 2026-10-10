"use server";

import { randomInt } from "crypto";

import { db } from "@/db";
import { appUsers, loginOtps } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sanitizeError } from "@/lib/errors";
import {
  checkRateLimit,
  checkAccountRateLimit,
  accountRateLimitKey,
  checkDailyEmailCap,
  resetRateLimit,
  getClientInfo,
  logLoginAttempt,
} from "@/lib/security";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendResetCode } from "@/lib/otp-codes";
import { validatePassword } from "@/lib/password";

/**
 * Who a reset request belongs to.
 *
 * OWNER ONLY, and enforced here rather than by which form was submitted. The
 * caller used to pass a `role` from the form, which made the staff flow a
 * self-service password reset: anyone holding a staff address could mail
 * themselves a code and set their own password. Staff passwords are the owner's
 * to set (Admin → Staff Logins), so there is no staff branch to reach at all —
 * the role is no longer an input from the client.
 *
 * The owner may also not exist in app_users: the original install is
 * authenticated purely by ADMIN_EMAIL/ADMIN_PASSWORD from the environment.
 * Before this existed, a reset for the owner address found no row and silently
 * took the "pretend it worked" enumeration branch, so no email was ever sent.
 */
type ResetTarget =
  | { kind: "db"; id: number; name: string; recipient: string }
  | { kind: "bootstrap-owner"; name: string; recipient: string };

async function resolveResetTarget(email: string): Promise<ResetTarget | null> {
  const users = await db
    .select()
    .from(appUsers)
    .where(
      and(
        eq(appUsers.email, email),
        eq(appUsers.role, "owner"),
        eq(appUsers.isActive, true)
      )
    )
    .limit(1);

  if (users.length > 0) {
    return {
      kind: "db",
      id: users[0].id,
      name: users[0].name,
      recipient: users[0].email,
    };
  }

  // Env-based owner. The code goes to OWNER_EMAIL (the owner's real inbox),
  // mirroring how login OTPs are routed.
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (adminEmail && email === adminEmail) {
    const recipient = process.env.OWNER_EMAIL || adminEmail;
    return { kind: "bootstrap-owner", name: "Owner", recipient };
  }

  return null;
}

/**
 * Step 1: User enters email → we send reset OTP to their email
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const captchaToken = String(formData.get("captchaToken") || "");
  const { ip } = await getClientInfo();

  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  // Rate limit
  const rateLimit = await checkRateLimit(`password-reset:${ip}`);
  if (!rateLimit.allowed) {
    return {
      error: `Too many reset requests. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  // Captcha
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  // Email service sanity check. Runs before the account lookup on purpose: the
  // answer is identical for every address, so it reveals nothing about whether
  // an account exists, and it turns a silent no-email-ever-arrives into a
  // visible error.
  if (!process.env.RESEND_API_KEY) {
    console.error("[Password Reset] RESEND_API_KEY is not set — cannot send.");
    return {
      error: "Email service is not configured. Contact the administrator.",
    };
  }

  try {
    const target = await resolveResetTarget(email);

    // Generic reply reused below so a capped address is indistinguishable from
    // an unknown one. Saying "too many requests for this address" here would
    // confirm the address exists and undo the enumeration defence above.
    const GENERIC_SENT = {
      success: true as const,
      message:
        "If an account exists with that email, a reset code has been sent.",
    };

    // ⚠️ Security: Always return success even if user doesn't exist
    // (prevents email enumeration attacks)
    if (!target) {
      console.log("[Password Reset] Non-owner email attempted:", email);
      return GENERIC_SENT;
    }

    // Per-address daily cap. The IP limit above is rotatable — this one is not,
    // because the address being attacked is the thing the attacker is aiming at.
    // Checked here, after the account is known to exist, so a flood of requests
    // for addresses that don't exist can never burn a real user's allowance.
    const cap = await checkDailyEmailCap(email);
    if (!cap.allowed) {
      console.error(
        `[Password Reset] daily email cap reached for ${email.slice(0, 2)}***  — ${cap.hoursLeft}h until reset`
      );
      return GENERIC_SENT;
    }

    // Generate a 6-digit OTP from a CSPRNG — see the note on generateOTP in
    // @/lib/otp-codes for why Math.random is the wrong source for this value.
    // Bounds are inclusive/exclusive respectively, so this is 100000–999999.
    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any previous unused OTPs for this email. Unscoped by purpose on
    // purpose — see the note in @/lib/otp-codes: at most one code is live per
    // address at a time, so the newest email is always the only one that works.
    await db
      .update(loginOtps)
      .set({ used: true })
      .where(and(eq(loginOtps.email, email), eq(loginOtps.used, false)));

    // Insert new OTP
    await db.insert(loginOtps).values({
      email,
      otp,
      expiresAt,
      used: false,
      // `purpose` is the machine-readable flow marker the verifier filters on.
      // `deviceInfo` keeps the same word as a human label in the table, for
      // anyone reading the rows directly.
      purpose: "password-reset",
      deviceInfo: "password-reset",
      ipAddress: ip,
    });

    // Send email
    const emailResult = await sendResetCode({
      recipient: target.recipient,
      otp,
      name: target.name,
    });

    if (emailResult.error) {
      // Deliberately not surfaced to the caller — an attacker must not be able
      // to tell a delivery failure from a non-existent account. But this is the
      // single most common reason a real user reports "no email arrived", so it
      // is logged loudly. A 403 here means the Resend sender domain is not
      // verified, and onboarding@resend.dev can only reach the address that
      // owns the Resend account.
      console.error(
        "[Password Reset] Email send FAILED for",
        target.recipient,
        "-",
        emailResult.error,
        "| FROM_EMAIL:",
        process.env.FROM_EMAIL || "(unset — using onboarding@resend.dev)"
      );
    }

    return {
      success: true,
      message:
        "If an account exists with that email, a reset code has been sent.",
    };
  } catch (error) {
    console.error("[Password Reset] Error:", error);
    return { error: sanitizeError(error, "Failed to send reset code.") };
  }
}

/**
 * Step 2: User enters OTP + new password → verify and update
 */
export async function resetPasswordWithOTP(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const otp = String(formData.get("otp") || "").trim();
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const captchaToken = String(formData.get("captchaToken") || "");
  const { ip } = await getClientInfo();

  // Basic validation
  if (!email || !otp || !newPassword) {
    return { error: "All fields are required." };
  }

  if (otp.length !== 6 || !/^\d+$/.test(otp)) {
    return { error: "OTP must be 6 digits." };
  }

  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // Password strength check using centralized validator
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) {
    return { error: passwordCheck.errors[0] };
  }

  // Rate limit. Both bounds, as on the login paths: the IP one is defeated by
  // rotating addresses, and this flow is guessing a 6-digit code, so the account
  // is the key that actually holds. `email` is non-empty here (guarded above).
  const rateLimit = await checkRateLimit(`reset-verify:${ip}`);
  if (!rateLimit.allowed) {
    return {
      error: `Too many attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  const accountLimit = await checkAccountRateLimit("reset-verify", email);
  if (!accountLimit.allowed) {
    return {
      error: `Too many attempts. Try again in ${accountLimit.blockMinutesLeft} minutes.`,
    };
  }

  // Captcha
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  try {
    const target = await resolveResetTarget(email);

    if (!target) {
      await logLoginAttempt({
        email,
        success: false,
        reason: "reset-user-not-found",
      });
      return { error: "Invalid email or OTP." };
    }

    // Find valid OTP
    const now = new Date();
    const otps = await db
      .select()
      .from(loginOtps)
      .where(
        and(
          eq(loginOtps.email, email),
          eq(loginOtps.otp, otp),
          // A login code must not be redeemable as a reset code: that is the
          // half of the crossing that would let a code phished out of the login
          // screen be spent on a password change.
          eq(loginOtps.purpose, "password-reset"),
          eq(loginOtps.used, false),
          gt(loginOtps.expiresAt, now)
        )
      )
      .limit(1);

    if (otps.length === 0) {
      await logLoginAttempt({
        email,
        success: false,
        reason: "reset-invalid-otp",
      });
      return {
        error: "Invalid or expired OTP. Please request a new one.",
      };
    }

    const otpRecord = otps[0];

    // Mark OTP as used
    await db
      .update(loginOtps)
      .set({ used: true })
      .where(eq(loginOtps.id, otpRecord.id));

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    if (target.kind === "db") {
      await db
        .update(appUsers)
        .set({ passwordHash })
        .where(eq(appUsers.id, target.id));
    } else {
      // Env-based owner with no app_users row yet. Create one so the new
      // password actually takes effect — writing nothing here is what made the
      // old flow appear to succeed while the password never changed.
      // verifyOwnerCredentials checks this row before ADMIN_PASSWORD, so the
      // new password wins from now on.
      await db.insert(appUsers).values({
        name: target.name,
        email,
        passwordHash,
        role: "owner",
        branchId: null,
        isActive: true,
      });
      console.warn(
        "[Password Reset] Created an owner row for",
        email,
        "— ADMIN_PASSWORD in .env is now superseded and should be removed or rotated."
      );
    }

    // Reset rate limits (user successfully recovered)
    await resetRateLimit(`reset-verify:${ip}`);
    await resetRateLimit(`login:${ip}`);
    await resetRateLimit(accountRateLimitKey("reset-verify", email));
    await resetRateLimit(accountRateLimitKey("login", email));

    await logLoginAttempt({
      email,
      success: true,
      reason: "password-reset-success",
    });

    return { success: true };
  } catch (error) {
    console.error("[Password Reset] Verify error:", error);
    return { error: sanitizeError(error, "Failed to reset password.") };
  }
}