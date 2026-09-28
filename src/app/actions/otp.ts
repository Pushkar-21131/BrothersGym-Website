"use server";

import { randomInt } from "crypto";
import { db } from "@/db";
import { loginOtps, appUsers } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { Resend } from "resend";
import { checkRateLimit, checkAccountRateLimit, checkDailyEmailCap, getClientInfo, logLoginAttempt } from "@/lib/security";
import { verifyTurnstile } from "@/lib/turnstile";
import { verifyOwnerCredentials } from "@/lib/verify-credentials";
import { fromHeader, otpEmail } from "@/lib/email-templates";
import { isPlaceholder } from "@/lib/env-placeholder";

/**
 * A 6-digit login code.
 *
 * crypto.randomInt, not Math.random. Math.random is a fast non-cryptographic PRNG
 * whose internal state can be recovered from a handful of outputs — and the
 * outputs here are OTPs, so an attacker who can request a few codes of their own
 * has samples of the same stream the owner's next code will come from. That is
 * the whole secret this function exists to generate.
 *
 * randomInt's upper bound is exclusive, so 1000000 gives 100000–999999: six
 * digits, never a leading zero.
 */
function generateOTP(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Get the recipient email for a login OTP.
 * - If it's the ADMIN_EMAIL (env-based owner) → send to OWNER_EMAIL
 * - If it's a DB-based owner (Shubhrant or Tushar) → send to their own email
 * - Otherwise → return null (invalid)
 */
async function getRecipientForLogin(email: string): Promise<string | null> {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const ownerEmail = process.env.OWNER_EMAIL;
  const inputLower = email.toLowerCase();

  // Env-based owner
  if (inputLower === adminEmail && ownerEmail) {
    return ownerEmail;
  }

  // DB-based owner (Shubhrant, Tushar, etc.)
  try {
    const users = await db
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.email, inputLower),
          eq(appUsers.role, "owner"),
          eq(appUsers.isActive, true)
        )
      )
      .limit(1);

    if (users.length > 0) {
      return users[0].email; // Send to their login email
    }
  } catch (e) {
    console.error("[OTP] DB lookup failed:", e);
  }

  return null;
}

// =========================================
// LOGIN OTP (existing — enhanced for multi-owner)
// =========================================
export async function sendLoginOTP(
  email: string,
  deviceInfo: string,
  password: string,
  captchaToken: string
) {
  const emailLower = email.toLowerCase();
  const { ip } = await getClientInfo();

  // Generic reply used for every rejection below, so a caller can't tell an
  // unknown email from a wrong password (and can't confirm the owner address).
  const GENERIC = { error: "Invalid owner email or password." };

  // 1. Rate limit BEFORE anything expensive. Shares the `login:` bucket with
  //    loginAction so attempts across both steps count toward the same block.
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

  // The same account-keyed bound the password step uses, so rotating IPs cannot
  // buy extra attempts against one owner address here either.
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

  // 2. Captcha must be valid before we spend an email.
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "captcha-failed",
    });
    return { error: captchaResult.error || "Captcha verification failed." };
  }

  // 3. The password must actually be correct. Without this check a wrong
  //    password still advanced to the OTP screen and sent a real email, which
  //    both leaked that the address was valid and burned the Resend quota.
  const identity = await verifyOwnerCredentials(emailLower, password);
  if (!identity) {
    await logLoginAttempt({
      email: emailLower,
      success: false,
      reason: "wrong-credentials",
    });
    const attemptsLeft = rateLimit.remainingAttempts ?? 0;
    const warning =
      attemptsLeft <= 2 ? ` (${attemptsLeft} attempts left before block)` : "";
    return { error: `${GENERIC.error}${warning}` };
  }

  // 4. Per-address daily cap. The IP limit in step 1 is rotatable; this one is
  //    not. Step 3 means an attacker needs the real password to get this far, so
  //    it is defence in depth rather than the front line — but if the password
  //    ever leaks, this stops the owner's own inbox being used to exhaust the
  //    Resend quota and lock him out. Naming the cap is safe here: whoever
  //    reached this point already proved they know the password.
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

  const otp = generateOTP();

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  try {
    // Invalidate any earlier unused codes so only the newest one works.
    //
    // Deliberately NOT scoped to purpose. Requesting a reset therefore also
    // cancels a pending login code for the same address, which is the point: at
    // most one code is live per address at a time, so "the newest email is the
    // only one that works" stays true and there is never a second guessable
    // value sitting in the table. The purpose filter below is what stops a code
    // crossing between flows; this is a separate property.
    await db
      .update(loginOtps)
      .set({ used: true })
      .where(and(eq(loginOtps.email, emailLower), eq(loginOtps.used, false)));

    // Save OTP to database
    await db.insert(loginOtps).values({
      email: emailLower,
      otp,
      expiresAt,
      used: false,
      purpose: "login",
      deviceInfo,
    });

    // Figure out where to send the email
    const recipientEmail = await getRecipientForLogin(emailLower);

    if (!recipientEmail) {
      // Credentials checked out but we have nowhere to send — a configuration
      // problem, not something the caller can fix by retrying.
      console.error("[OTP] No recipient configured for", emailLower);
      return { error: "Login email is not configured. Contact administrator." };
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[DEV] Login OTP for",
        recipientEmail.slice(0, 3) + "***:",
        otp
      );
    }

    const mail = otpEmail({
      kind: "login",
      otp,
      deviceInfo,
      expiresMinutes: 5,
    });

    // Constructed here rather than at module scope. The SDK's constructor throws
    // "Missing API key" when the key is absent, so a module-scope `new Resend()`
    // took the whole module down at import — and this module is what owner login,
    // staff login and the join flow all reach. A missing key became "login is
    // broken" instead of "email is not set up". It is also required at build time
    // now (see env-check.ts), so this is the second line of defence.
    if (isPlaceholder(process.env.RESEND_API_KEY)) {
      console.error("[OTP] RESEND_API_KEY is not set — cannot send a login code.");
      return { error: "Email is not configured. Contact administrator." };
    }

    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: fromHeader(),
      to: recipientEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("📧 Resend response:", result);
    }

    if (result.error) {
      console.error("❌ Resend error:", result.error);
      return { error: `Email failed: ${result.error.message}` };
    }

    return { success: true };
  } catch (e: any) {
    console.error("❌ Login OTP send failed:", e);
    return { error: e.message || "Failed to send verification code." };
  }
}

// =========================================
// VERIFY LOGIN OTP (existing — unchanged)
// =========================================
export async function verifyLoginOTP(email: string, otpInput: string) {
  try {
    const now = new Date();

    const results = await db
      .select()
      .from(loginOtps)
      .where(
        and(
          eq(loginOtps.email, email.toLowerCase()),
          eq(loginOtps.otp, otpInput),
          // A code minted by the password-reset flow must not be redeemable
          // here. Without this the two flows share one pool of codes and a
          // reset code is a login code.
          eq(loginOtps.purpose, "login"),
          eq(loginOtps.used, false),
          gt(loginOtps.expiresAt, now)
        )
      )
      .limit(1);

    if (results.length === 0) {
      return { error: "Invalid or expired code. Please try again." };
    }

    await db
      .update(loginOtps)
      .set({ used: true })
      .where(eq(loginOtps.id, results[0].id));

    return { success: true };
  } catch (e: any) {
    console.error("[OTP] Verification failed:", e);
    return { error: "Verification failed" };
  }
}

// =========================================
// PASSWORD RESET EMAIL (NEW)
// =========================================
/**
 * Send password reset OTP to user's registered email.
 * Called from password-reset flow.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  otp: string,
  userName: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[DEV] Password reset OTP for",
        toEmail.slice(0, 3) + "***:",
        otp
      );
    }

    const mail = otpEmail({
      kind: "reset",
      otp,
      name: userName,
      expiresMinutes: 10,
    });

    if (isPlaceholder(process.env.RESEND_API_KEY)) {
      console.error(
        "[OTP] RESEND_API_KEY is not set — cannot send a password reset code."
      );
      return { error: "Email is not configured. Contact administrator." };
    }

    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: fromHeader(),
      to: toEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (result.error) {
      console.error("❌ Password reset email error:", result.error);
      return { error: `Email failed: ${result.error.message}` };
    }

    return { success: true };
  } catch (e: any) {
    console.error("❌ Password reset email failed:", e);
    return { error: e.message || "Failed to send reset email." };
  }
}