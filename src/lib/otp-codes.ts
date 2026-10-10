/**
 * The one-time-code lifecycle for signing in and for resetting a password:
 * mint, store, verify, email.
 *
 * A plain lib module, NOT a "use server" file, and that is the whole point of
 * it existing separately. Importing ONE function from a "use server" file
 * exposes EVERY export of that file as a public endpoint — the action manifest
 * Next generates from a client import lists all of them, so there is no such
 * thing as a "private" export of such a module. Anything here that takes a
 * recipient address, or that answers "is this code the right one?", must
 * therefore not live in one. The sign-in and reset flows reach these only after
 * checking a password or a rate limit themselves.
 */

import { randomInt } from "crypto";
import { db } from "@/db";
import { loginOtps } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { Resend } from "resend";
import { fromHeader, otpEmail } from "@/lib/email-templates";
import { isPlaceholder } from "@/lib/env-placeholder";

/**
 * A 6-digit code.
 *
 * crypto.randomInt, not Math.random. Math.random is a fast non-cryptographic PRNG
 * whose internal state can be recovered from a handful of outputs — and the
 * outputs here are OTPs, so an attacker who can request a few codes of their own
 * has samples of the same stream the next code will come from. That is the
 * whole secret this function exists to generate.
 *
 * randomInt's upper bound is exclusive, so 1000000 gives 100000–999999: six
 * digits, never a leading zero.
 */
function generateOTP(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Invalidate any live code for this address, store a fresh one, and email it.
 *
 * `recipient` is where the mail goes, which is not always `email` — the owner
 * signs in with an address that forwards to their real inbox.
 */
export async function issueLoginCode(opts: {
  email: string;
  recipient: string;
  deviceInfo: string;
}): Promise<{ success?: true; error?: string }> {
  const { email, recipient, deviceInfo } = opts;
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  try {
    // Invalidate any earlier unused codes so only the newest one works.
    //
    // Deliberately NOT scoped to purpose. Requesting a reset therefore also
    // cancels a pending login code for the same address, which is the point: at
    // most one code is live per address at a time, so "the newest email is the
    // only one that works" stays true and there is never a second guessable
    // value sitting in the table. The purpose filter at verification is what
    // stops a code crossing between flows; this is a separate property.
    await db
      .update(loginOtps)
      .set({ used: true })
      .where(and(eq(loginOtps.email, email), eq(loginOtps.used, false)));

    await db.insert(loginOtps).values({
      email,
      otp,
      expiresAt,
      used: false,
      purpose: "login",
      deviceInfo,
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV] Login OTP for", recipient.slice(0, 3) + "***:", otp);
    }

    const mail = otpEmail({
      kind: "login",
      otp,
      deviceInfo,
      expiresMinutes: 5,
    });

    // Constructed here rather than at module scope. The SDK's constructor throws
    // "Missing API key" when the key is absent, so a module-scope `new Resend()`
    // takes the whole module down at import — and this module is what owner
    // login, staff login and the join flow all reach. A missing key becomes
    // "login is broken" instead of "email is not set up".
    if (isPlaceholder(process.env.RESEND_API_KEY)) {
      console.error("[OTP] RESEND_API_KEY is not set — cannot send a login code.");
      return { error: "Email is not configured. Contact administrator." };
    }

    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: fromHeader(),
      to: recipient,
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
  } catch (e) {
    console.error("❌ Login OTP send failed:", e);
    return {
      error: e instanceof Error ? e.message : "Failed to send verification code.",
    };
  }
}

/**
 * Check a 6-digit sign-in code and spend it.
 *
 * Only the two login actions call this, and only after they have verified the
 * password — which is why it is here and not next to them. Exported from a
 * "use server" file it was reachable by anyone, with no rate limit in front of
 * it, letting a caller test guesses against a live code for free and submit the
 * winning one through the real login step seconds later. Kept out of the action
 * file, a caller has to pay the rate limiter on the way in.
 */
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
  } catch (e) {
    console.error("[OTP] Verification failed:", e);
    return { error: "Verification failed" };
  }
}

/**
 * Email a reset code that the caller has already generated and stored.
 *
 * Minting and storing stay with the reset action, because they are the part
 * bound to the reset flow's own rate limits and daily cap. This only sends.
 */
export async function sendResetCode(opts: {
  recipient: string;
  otp: string;
  name: string;
}): Promise<{ success?: boolean; error?: string }> {
  const { recipient, otp, name } = opts;

  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV] Password reset OTP for", recipient.slice(0, 3) + "***:", otp);
    }

    const mail = otpEmail({
      kind: "reset",
      otp,
      name,
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
      to: recipient,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (result.error) {
      console.error("❌ Password reset email error:", result.error);
      return { error: `Email failed: ${result.error.message}` };
    }

    return { success: true };
  } catch (e) {
    console.error("❌ Password reset email failed:", e);
    return {
      error: e instanceof Error ? e.message : "Failed to send reset email.",
    };
  }
}
