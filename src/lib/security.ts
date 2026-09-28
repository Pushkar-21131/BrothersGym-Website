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
 * A well-formed IPv4 or IPv6 literal, or null.
 *
 * WHY VALIDATE AT ALL
 * Whatever this returns becomes the key of a rate-limit bucket and a column in
 * every audit row. Unvalidated, it is an arbitrary attacker-supplied string:
 * `rate_limit_attempts.identifier` is unbounded `text` with a UNIQUE index, so a
 * ~3KB header value makes the insert itself fail, and any value at all becomes a
 * bucket the caller chose.
 *
 * The length cap is checked first for exactly that reason. 45 characters is the
 * longest possible IPv6 literal including an embedded IPv4 address.
 */
function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 45) return null;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    return v4.slice(1).every((octet) => Number(octet) <= 255) ? value : null;
  }

  // IPv4-mapped IPv6 (::ffff:203.0.113.5) — what a dual-stack proxy often sends.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) return normaliseIp(mapped[1]);

  // Hex groups joined by colons, at most one "::" run. Permissive about group
  // count (the goal is "not an arbitrary string", not RFC-perfect parsing) but
  // strict about the alphabet, so no header text survives as a bucket name.
  return /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(value) ? value : null;
}

/**
 * The caller's IP, as far as it can be trusted, plus their user agent.
 *
 * ORDER MATTERS, AND IT USED TO BE WRONG. The previous version consulted
 * `x-vercel-forwarded-for` and then `x-real-ip` before `x-forwarded-for`, on the
 * reasoning that "behind Vercel the proxy rewrites the header". This deployment
 * is on NETLIFY — the comment described a host we do not use. Netlify sets
 * neither of those headers, so both branches read values the CLIENT supplied,
 * and a request carrying `X-Vercel-Forwarded-For: <random>` got a fresh bucket
 * every time. That defeated every IP-keyed limiter at once — login, OTP,
 * password-reset, member lookup, payment verification — and poisoned the audit
 * rows and the recorded consent IP along with them.
 *
 * So the host's own header comes first, and the client-settable ones are only a
 * fallback for local development:
 *
 *   1. x-nf-client-connection-ip — set by Netlify's edge from the connection
 *      itself. Overwritten, not appended, so the client cannot choose it.
 *   2. x-forwarded-for — a client-settable chain. The RIGHTMOST hop is taken,
 *      because that is the one our own proxy appended; the leftmost is whatever
 *      the original client claimed about itself.
 *   3. x-real-ip — last, for any non-Netlify host.
 *
 * Anything that does not parse as an IP becomes "unknown", which puts those
 * requests in one shared bucket rather than a bucket of the caller's choosing.
 * An IP is never a sufficient key on its own anyway — see the account-keyed
 * counters alongside the IP ones in auth.ts and password-reset.ts.
 */
export async function getClientInfo() {
  const h = await headers();

  let ip =
    normaliseIp(h.get("x-nf-client-connection-ip")) ??
    null;

  if (!ip) {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded.split(",");
      for (let i = hops.length - 1; i >= 0 && !ip; i--) {
        ip = normaliseIp(hops[i]);
      }
    }
  }

  ip = ip ?? normaliseIp(h.get("x-real-ip")) ?? "unknown";

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
 * Thresholds for the per-ACCOUNT limiter. Deliberately looser than the per-IP
 * defaults above; the reasoning is in checkAccountRateLimit.
 */
const ACCOUNT_MAX_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MINUTES = 60;
const ACCOUNT_BLOCK_MINUTES = 15;

/**
 * The bucket name for one account on one flow. Exported so a successful login
 * can clear it with resetRateLimit — a stale account block that outlives the
 * real login is a lockout the owner cannot explain.
 */
export function accountRateLimitKey(
  flow: "login" | "reset-verify",
  account: string
): string {
  return `${flow}:acct:${account.trim().toLowerCase()}`;
}

/**
 * A second limiter keyed on the ACCOUNT rather than the IP.
 *
 * WHY AN IP IS NOT ENOUGH, EVEN WHEN THE HEADER IS TRUSTWORTHY
 * IPs are free and disposable. Anyone with a proxy list or a phone hotspot walks
 * past an IP-keyed limit by rotating, and the password-guessing flows are
 * exactly where that matters: the attacker picks one known owner address and
 * guesses against it from a new IP every few requests. The account is the one
 * part of the request they cannot rotate, because naming it is the attack.
 *
 * WHY THESE NUMBERS ARE LOOSER THAN THE IP BUCKET'S
 * A global per-account counter is also a way to lock a real owner out of their
 * own dashboard: trip it and nobody can log in to that account from anywhere,
 * including the person who owns it. 10 failures in an hour is far past anything
 * a genuine mistype produces and still only 240 guesses a day, which is nothing
 * against a real password — and the 15-minute block (half the IP bucket's)
 * bounds the damage in the case where an attacker does trip it deliberately.
 *
 * The prefix keeps this inside FAIL_CLOSED_PREFIXES, so a database failure
 * pauses the flow rather than removing the limit — see the note there.
 */
export async function checkAccountRateLimit(
  flow: "login" | "reset-verify",
  account: string
) {
  return checkRateLimit(accountRateLimitKey(flow, account), {
    max: ACCOUNT_MAX_ATTEMPTS,
    windowMinutes: ACCOUNT_WINDOW_MINUTES,
    blockMinutes: ACCOUNT_BLOCK_MINUTES,
  });
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