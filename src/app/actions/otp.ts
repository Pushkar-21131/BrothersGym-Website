"use server";

// sendLoginOTP is the only export here on purpose. Every export of a "use
// server" file is a publicly callable endpoint — importing one from a client
// component exposes all of them — so the verifier and the reset mailer live in
// @/lib/otp-codes instead, reachable only from server code.

import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  checkRateLimit,
  checkAccountRateLimit,
  checkDailyEmailCap,
  getClientInfo,
  logLoginAttempt,
} from "@/lib/security";
import { verifyTurnstile } from "@/lib/turnstile";
import { verifyOwnerCredentials } from "@/lib/verify-credentials";
import { issueLoginCode } from "@/lib/otp-codes";

/**
 * Get the recipient email for a login OTP.
 * - If it's the ADMIN_EMAIL (env-based owner) → send to OWNER_EMAIL
 * - If it's a branch owner stored in app_users → send to their own email
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

  // Branch owner: a row in app_users, not the env-configured super-admin.
  // Deliberately not naming anyone -- these comments used to list the owners by
  // name and went stale the first time a branch changed hands.
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

/**
 * Step 1 of the owner login: password + captcha in, a login code out.
 */
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

  // 5. Where the code goes, resolved BEFORE anything is written. Doing this the
  //    other way round left a live code in the table for an address with no
  //    recipient — unreachable, but still a row the newest-code-wins rule has to
  //    reason about.
  const recipientEmail = await getRecipientForLogin(emailLower);
  if (!recipientEmail) {
    // Credentials checked out but we have nowhere to send — a configuration
    // problem, not something the caller can fix by retrying.
    console.error("[OTP] No recipient configured for", emailLower);
    return { error: "Login email is not configured. Contact administrator." };
  }

  return issueLoginCode({ email: emailLower, recipient: recipientEmail, deviceInfo });
}
