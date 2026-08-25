"use server";

import { db } from "@/db";
import { appUsers, loginOtps } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sanitizeError } from "@/lib/errors";
import {
  checkRateLimit,
  checkDailyEmailCap,
  resetRateLimit,
  getClientInfo,
  logLoginAttempt,
} from "@/lib/security";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendPasswordResetEmail } from "@/app/actions/otp";
import { validatePassword } from "@/lib/password";

/**
 * Who a reset request belongs to.
 *
 * The owner may not exist in app_users at all — the original install is
 * authenticated purely by ADMIN_EMAIL/ADMIN_PASSWORD from the environment.
 * Before this existed, a reset for the owner address found no row and silently
 * took the "pretend it worked" enumeration branch, so no email was ever sent.
 */
type ResetTarget =
  | { kind: "db"; id: number; name: string; recipient: string }
  | { kind: "bootstrap-owner"; name: string; recipient: string };

async function resolveResetTarget(
  email: string,
  role: "owner" | "staff"
): Promise<ResetTarget | null> {
  const users = await db
    .select()
    .from(appUsers)
    .where(
      and(
        eq(appUsers.email, email),
        eq(appUsers.role, role),
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
  if (role === "owner" && adminEmail && email === adminEmail) {
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
  const role = String(formData.get("role") || "staff") as "owner" | "staff";
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
    const target = await resolveResetTarget(email, role);

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
      console.log(
        `[Password Reset] Non-existent ${role} email attempted:`,
        email
      );
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

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any previous unused OTPs for this email
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
      deviceInfo: "password-reset",
      ipAddress: ip,
    });

    // Send email
    const emailResult = await sendPasswordResetEmail(
      target.recipient,
      otp,
      target.name
    );

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
  const role = String(formData.get("role") || "staff") as "owner" | "staff";
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

  // Rate limit
  const rateLimit = await checkRateLimit(`reset-verify:${ip}`);
  if (!rateLimit.allowed) {
    return {
      error: `Too many attempts. Try again in ${rateLimit.blockMinutesLeft} minutes.`,
    };
  }

  // Captcha
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  try {
    const target = await resolveResetTarget(email, role);

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