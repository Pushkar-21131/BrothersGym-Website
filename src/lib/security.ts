import { db } from "@/db";
import { rateLimitAttempts, loginAttempts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const BLOCK_MINUTES = 30;

/**
 * How many emails a single address may trigger in a rolling 24 hours.
 *
 * The owner logs in a handful of times a day and each login is one OTP, so 10
 * leaves plenty of headroom for mistyped codes and "resend" clicks.
 */
const DAILY_EMAIL_CAP = 10;

export async function getClientInfo() {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const userAgent = h.get("user-agent") || "unknown";
  return { ip, userAgent };
}

/**
 * Check if this IP/email is rate-limited.
 * Returns true if allowed, false if blocked.
 */
export async function checkRateLimit(identifier: string) {
  try {
    // Single atomic upsert. Concurrent requests for the same identifier can no
    // longer each read "no row" and split the counter across duplicate rows —
    // the UNIQUE(identifier) constraint funnels them all through ON CONFLICT,
    // and Postgres serializes the conflicting updates.
    //
    // The CASE expressions reproduce the previous behavior exactly:
    //   - still blocked            → leave the row untouched
    //   - rolling window expired   → reset to attempt 1, clear the block
    //   - otherwise                → increment; if this pushes past MAX, block
    const res = await db.execute(sql`
      INSERT INTO rate_limit_attempts (identifier, attempts, window_start, blocked_until)
      VALUES (${identifier}, 1, now(), NULL)
      ON CONFLICT (identifier) DO UPDATE SET
        attempts = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.attempts
          WHEN rate_limit_attempts.window_start + (${WINDOW_MINUTES} * interval '1 minute') < now()
            THEN 1
          ELSE rate_limit_attempts.attempts + 1
        END,
        window_start = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.window_start
          WHEN rate_limit_attempts.window_start + (${WINDOW_MINUTES} * interval '1 minute') < now()
            THEN now()
          ELSE rate_limit_attempts.window_start
        END,
        blocked_until = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.blocked_until
          WHEN rate_limit_attempts.window_start + (${WINDOW_MINUTES} * interval '1 minute') < now()
            THEN NULL
          WHEN rate_limit_attempts.attempts + 1 > ${MAX_ATTEMPTS}
            THEN now() + (${BLOCK_MINUTES} * interval '1 minute')
          ELSE rate_limit_attempts.blocked_until
        END
      RETURNING attempts, blocked_until
    `);

    const row = res.rows[0] as
      | { attempts: number; blocked_until: Date | string | null }
      | undefined;

    if (!row) {
      // Should not happen (INSERT or UPDATE always returns a row), but fail open.
      return { allowed: true, remainingAttempts: MAX_ATTEMPTS };
    }

    const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
    const now = Date.now();

    if (blockedUntil && blockedUntil.getTime() > now) {
      return {
        allowed: false,
        blocked: true,
        blockMinutesLeft: Math.ceil((blockedUntil.getTime() - now) / 60000),
      };
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, MAX_ATTEMPTS - Number(row.attempts)),
    };
  } catch (e) {
    // If rate limit check fails, allow (don't block real users)
    console.error("Rate limit check failed:", e);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS };
  }
}

/**
 * Cap how many emails one address can trigger per rolling 24 hours.
 *
 * WHY THIS EXISTS, SEPARATELY FROM checkRateLimit
 * Every other limit here is keyed on IP. IPs are free and disposable: anyone
 * with a phone hotspot or a proxy list can walk past an IP limit by rotating.
 * That is survivable for a login guess, because the password still has to be
 * right — but OTP and password-reset requests SEND AN EMAIL before any secret is
 * checked. On Resend's free tier that is 100 messages a day, shared by the whole
 * app, and the owner's login OTP comes out of the same allowance.
 *
 * So an attacker who never guesses a single password can still exhaust the quota
 * and lock the owner out of his own admin panel. Denial of service by way of the
 * billing plan. This cap is keyed on the email address instead, which is the one
 * part of the request an attacker cannot rotate — the target address is the
 * whole point of the attack.
 *
 * Deliberately NOT reset on success: a legitimate login should not hand back
 * fresh quota, or the cap is trivially cleared by anyone who can log in.
 *
 * Count only actual sends. Calling this on requests that don't send an email
 * (unknown address, already-blocked) would let an attacker burn a real user's
 * daily allowance without a single message ever leaving.
 */
export async function checkDailyEmailCap(email: string, max = DAILY_EMAIL_CAP) {
  const identifier = `email-daily:${email.trim().toLowerCase()}`;

  try {
    // Same atomic upsert shape as checkRateLimit, but a 24h rolling window and
    // no escalating block — the count alone is the limit.
    const res = await db.execute(sql`
      INSERT INTO rate_limit_attempts (identifier, attempts, window_start, blocked_until)
      VALUES (${identifier}, 1, now(), NULL)
      ON CONFLICT (identifier) DO UPDATE SET
        attempts = CASE
          WHEN rate_limit_attempts.window_start + interval '24 hours' < now()
            THEN 1
          ELSE rate_limit_attempts.attempts + 1
        END,
        window_start = CASE
          WHEN rate_limit_attempts.window_start + interval '24 hours' < now()
            THEN now()
          ELSE rate_limit_attempts.window_start
        END
      RETURNING attempts, window_start
    `);

    const row = res.rows[0] as
      | { attempts: number; window_start: Date | string }
      | undefined;

    if (!row) return { allowed: true, remaining: max };

    const attempts = Number(row.attempts);
    if (attempts > max) {
      const windowStart = new Date(row.window_start);
      const resetsAt = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
      const hoursLeft = Math.max(
        1,
        Math.ceil((resetsAt.getTime() - Date.now()) / (60 * 60 * 1000))
      );
      return { allowed: false, remaining: 0, hoursLeft };
    }

    return { allowed: true, remaining: Math.max(0, max - attempts) };
  } catch (e) {
    // Matches checkRateLimit: a broken limiter must not lock out real users.
    console.error("Daily email cap check failed:", e);
    return { allowed: true, remaining: max };
  }
}

/**
 * Reset rate limit for identifier (on successful login).
 */
export async function resetRateLimit(identifier: string) {
  try {
    await db
      .delete(rateLimitAttempts)
      .where(eq(rateLimitAttempts.identifier, identifier));
  } catch (e) {
    console.error("Rate limit reset failed:", e);
  }
}

/**
 * Log a login attempt.
 */
export async function logLoginAttempt(data: {
  email: string;
  success: boolean;
  reason?: string;
}) {
  try {
    const { ip, userAgent } = await getClientInfo();
    await db.insert(loginAttempts).values({
      email: data.email,
      ipAddress: ip,
      userAgent: userAgent.slice(0, 250),
      success: data.success,
      reason: data.reason || null,
    });
  } catch (e) {
    console.error("Login logging failed:", e);
  }
}