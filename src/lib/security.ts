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

/**
 * Identifier prefixes whose limiter must FAIL CLOSED.
 *
 * Every checkRateLimit call used to return `{ allowed: true }` when the query
 * itself failed, on the reasoning that a database blip should not lock out a
 * paying customer. That is the right trade for the join form and the status
 * poll — a blocked customer is a lost sale, and there is no secret being
 * guessed.
 *
 * It is the wrong trade for anything guarding a secret. These endpoints check a
 * password, an OTP, a reset token, or a member's ID-and-phone pair, and for
 * those the limiter IS the defense: an unlimited number of guesses is the whole
 * prize. The realistic window is not a total outage — an outage takes the
 * lookup being brute-forced down with it — but partial pooler degradation,
 * where the limiter's write fails while the read the attacker wants still
 * succeeds.
 *
 * Prefixes, matched against the identifier's part before the first ":":
 *   login         — password and OTP verification (auth.ts, otp.ts)
 *   lookup        — member ID + phone, the enumeration target (payments.ts)
 *   password-reset / reset-verify — reset request and token check
 *   verify        — payment signature verification
 * Left failing open on purpose: join, joinstatus, joinpoll.
 */
const FAIL_CLOSED_PREFIXES = new Set([
  "login",
  "lookup",
  "password-reset",
  "reset-verify",
  "verify",
]);

/**
 * How long to tell the caller to wait when the limiter itself is broken.
 *
 * Short on purpose. The block is not a punishment for the user in front of it —
 * it is a pause while the database recovers, and a 30-minute lockout from a
 * five-second blip would be its own outage.
 */
const FAIL_CLOSED_RETRY_MINUTES = 1;

function failClosed(identifier: string) {
  return FAIL_CLOSED_PREFIXES.has(identifier.split(":")[0]);
}

/**
 * The caller's IP, as far as it can be trusted, plus their user agent.
 *
 * ORDER MATTERS. `x-forwarded-for` is a client-settable header: it arrives as a
 * comma-separated chain and the leftmost entry is whatever the *original* client
 * claimed. Behind Vercel that is safe, because Vercel rewrites the header with
 * the real socket address — but "the proxy overwrites it" is a property of the
 * deployment, not of this function, and every rate limit and audit row here is
 * keyed on what it returns. Run this behind anything that appends rather than
 * replaces, and an attacker picks their own rate-limit bucket per request.
 *
 * So the Vercel-specific headers are consulted first. `x-vercel-forwarded-for`
 * is set by Vercel's edge from the connection itself and cannot be spoofed by
 * the client; `x-real-ip` likewise. `x-forwarded-for` stays as the last resort
 * for local development and any non-Vercel host, where it is the only thing
 * available — but it is no longer the first choice merely because it is the
 * best-known name.
 */
export async function getClientInfo() {
  const h = await headers();
  const ip =
    h.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";
  const userAgent = h.get("user-agent") || "unknown";
  return { ip, userAgent };
}

/**
 * Check if this IP/email is rate-limited.
 * Returns true if allowed, false if blocked.
 *
 * The defaults (5 / 15min / 30min block) are tuned for guessing a secret — a
 * login, an OTP, a member lookup — where being slow is the entire point. Callers
 * whose economics differ can override them.
 *
 * The one that actually needs this is the join status poll: it re-checks an
 * already-authenticated request every few seconds, so the default would lock a
 * member out of watching their own membership inside two minutes. It authorises
 * with a signed token rather than a guessable secret, so its limit exists only to
 * stop a flood, not to slow an attacker down.
 */
export async function checkRateLimit(
  identifier: string,
  opts?: { max?: number; windowMinutes?: number; blockMinutes?: number }
) {
  const max = opts?.max ?? MAX_ATTEMPTS;
  const windowMinutes = opts?.windowMinutes ?? WINDOW_MINUTES;
  const blockMinutes = opts?.blockMinutes ?? BLOCK_MINUTES;

  try {
    // Single atomic upsert. Concurrent requests for the same identifier can no
    // longer each read "no row" and split the counter across duplicate rows —
    // the UNIQUE(identifier) constraint funnels them all through ON CONFLICT,
    // and Postgres serializes the conflicting updates.
    //
    // The CASE expressions reproduce the previous behavior exactly:
    //   - still blocked            → leave the row untouched
    //   - rolling window expired   → reset to attempt 1, clear the block
    //   - otherwise                → increment; if this pushes past max, block
    const res = await db.execute(sql`
      INSERT INTO rate_limit_attempts (identifier, attempts, window_start, blocked_until)
      VALUES (${identifier}, 1, now(), NULL)
      ON CONFLICT (identifier) DO UPDATE SET
        attempts = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.attempts
          WHEN rate_limit_attempts.window_start + (${windowMinutes} * interval '1 minute') < now()
            THEN 1
          ELSE rate_limit_attempts.attempts + 1
        END,
        window_start = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.window_start
          WHEN rate_limit_attempts.window_start + (${windowMinutes} * interval '1 minute') < now()
            THEN now()
          ELSE rate_limit_attempts.window_start
        END,
        blocked_until = CASE
          WHEN rate_limit_attempts.blocked_until IS NOT NULL
               AND rate_limit_attempts.blocked_until > now()
            THEN rate_limit_attempts.blocked_until
          WHEN rate_limit_attempts.window_start + (${windowMinutes} * interval '1 minute') < now()
            THEN NULL
          WHEN rate_limit_attempts.attempts + 1 > ${max}
            THEN now() + (${blockMinutes} * interval '1 minute')
          ELSE rate_limit_attempts.blocked_until
        END
      RETURNING attempts, blocked_until
    `);

    const row = res.rows[0] as
      | { attempts: number; blocked_until: Date | string | null }
      | undefined;

    if (!row) {
      // INSERT or UPDATE always returns a row, so reaching here means the
      // statement did something unexpected rather than nothing. Treated like
      // the catch below: guard a secret and you get a pause, guard a form and
      // you get through.
      if (failClosed(identifier)) {
        return {
          allowed: false,
          blocked: true,
          blockMinutesLeft: FAIL_CLOSED_RETRY_MINUTES,
        };
      }
      return { allowed: true, remainingAttempts: max };
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
      remainingAttempts: Math.max(0, max - Number(row.attempts)),
    };
  } catch (e) {
    console.error("Rate limit check failed:", e);

    // No counter means no limit, so for anything guarding a secret the safe
    // answer is "not now" — see FAIL_CLOSED_PREFIXES. Everything else still
    // fails open, because blocking a customer over a database blip is worse
    // than the spam it would prevent.
    if (failClosed(identifier)) {
      return {
        allowed: false,
        blocked: true,
        blockMinutesLeft: FAIL_CLOSED_RETRY_MINUTES,
      };
    }
    return { allowed: true, remainingAttempts: max };
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