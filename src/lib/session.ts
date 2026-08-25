/**
 * Signed session handling.
 *
 * The admin session is a single signed JWT stored in the `admin_session` cookie.
 * Everything that previously read admin_token/admin_role/admin_name/admin_branch
 * as plaintext now reads this one signed cookie — a forged cookie is rejected
 * because it fails signature verification.
 *
 * The session is used by:
 *  - middleware.ts        (Edge runtime → uses jose, not node crypto)
 *  - lib/auth-check.ts    (server actions / server components)
 *  - lib/audit.ts         (audit logging)
 *  - lib/branch.ts        (branch scope)
 *
 * Session payload:
 *  - sub:   "owner" for the env-based owner, otherwise the appUsers id (number)
 *  - role:  "owner" | "staff"
 *  - name:  display name
 *  - branchId: number | null (owner = null)
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type SessionRole = "owner" | "staff";

export type SessionPayload = {
  sub: string; // "owner" (env owner) or the user id (e.g. "12")
  role: SessionRole;
  name: string;
  branchId: number | null;
};

export const SESSION_COOKIE = "admin_session";
// Admin sessions slide on activity — the middleware re-issues this token on
// every /admin request — so this is really the inactivity window: 3 days with
// no request logs the user out. The extra hour is headroom so the signed token
// always outlives the middleware's `last_activity` check, letting the user hit
// the explicit "session expired" screen instead of a silent redirect.
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 3 + 60 * 60; // 3 days + 1h

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Set it in your environment (e.g. .env) before logging in."
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Create a signed session token for the given user.
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ role: payload.role, name: payload.name, branchId: payload.branchId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verify a session token. Returns the payload, or null if missing/invalid/expired.
 */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    const role = payload.role;
    const name = payload.name;
    const branchId = payload.branchId;
    if (
      typeof payload.sub !== "string" ||
      (role !== "owner" && role !== "staff") ||
      typeof name !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      role,
      name,
      branchId: typeof branchId === "number" ? branchId : null,
    };
  } catch {
    // Invalid signature, malformed token, or expired — treat as logged out.
    return null;
  }
}

/**
 * Standard cookie options used for the session cookie.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_SECONDS,
    path: "/",
    sameSite: "lax" as const,
  };
}
