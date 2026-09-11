import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  verifySessionToken,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session";

const SESSION_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000; // 3 days of inactivity

// ===== Hidden login paths =================================================
// The real login URLs live ONLY in environment variables — never in the
// committed source, so they never appear in the public GitHub repo. Each env
// var maps a secret, unguessable path to a generic internal route that renders
// the actual login form:
//
//   OWNER_LOGIN_PATH  →  /owner-login   (owner: password + email OTP)
//   STAFF_LOGIN_PATH  →  /login         (staff: password only)
//
// When the env var is SET (production): middleware rewrites the secret path
// onto the internal route, and blocks any direct hit on the internal route by
// bouncing it to the homepage. So neither reading the repo nor guessing the
// generic name (`/login`, `/owner-login`) reveals a working entrance.
//
// When the env var is UNSET (local dev): the internal route is served directly,
// so development needs no secret configured — just visit /login or /owner-login.
//
// This is obscurity, NOT the security boundary. Real protection is the
// password, the owner's email OTP, the Turnstile captcha, DB-backed login rate
// limiting, and the signed + DB-validated session. Hiding the path only keeps
// the entrance out of the public repo and off search engines.
const OWNER_INTERNAL = "/owner-login";
const STAFF_INTERNAL = "/login";

// Turn a raw env value ("team-portal-x9") into a normalized path ("/team-portal-x9").
// Returns null when unset/blank so callers can fall back to the internal route.
function normalizePath(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed ? `/${trimmed}` : null;
}

/**
 * Apply security headers to any response.
 * These enhance the base headers set in next.config.ts.
 */
function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("X-Download-Options", "noopen");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  return response;
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete("admin_branch");
  response.cookies.delete("last_activity");
  // Legacy plaintext cookies from before the signed-session migration.
  response.cookies.delete("admin_token");
  response.cookies.delete("admin_role");
  response.cookies.delete("admin_name");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const ownerSecret = normalizePath(process.env.OWNER_LOGIN_PATH);
  const staffSecret = normalizePath(process.env.STAFF_LOGIN_PATH);

  // A "login page" request is the secret path when one is configured, or the
  // internal route itself when it is not (local dev).
  const isOwnerLogin = pathname === (ownerSecret ?? OWNER_INTERNAL);
  const isStaffLogin = pathname === (staffSecret ?? STAFF_INTERNAL);

  // Verify the signed session. A forged/tampered cookie fails verification
  // and is treated as logged out.
  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value
  );
  const isAuthed = session !== null;
  const role = session?.role;

  // ===== 1. Session timeout check =====
  if (isAuthed) {
    const lastActivity = request.cookies.get("last_activity")?.value;
    if (lastActivity) {
      const parsed = parseInt(lastActivity);
      // A non-numeric/garbled value can't be trusted — force re-login.
      const timeSince = Number.isNaN(parsed)
        ? Number.POSITIVE_INFINITY
        : Date.now() - parsed;
      if (timeSince > SESSION_TIMEOUT_MS) {
        // Sent to the homepage, never to a login path — the path stays secret.
        // The user re-enters via their bookmarked secret URL.
        const response = NextResponse.redirect(new URL("/", request.url));
        clearSessionCookies(response);
        return applySecurityHeaders(response);
      }
    }
    // If `last_activity` is missing it is (re)stamped in section 6 below, so a
    // fresh session isn't kicked out on its very first admin request.
  }

  // ===== 2. Block direct hits on the internal login routes =====
  // Only active once a secret path is configured for that role. This bounces
  // anyone who reads the generic route name out of the repo — and any stale
  // redirect("/login") fallback deeper in the app — to the homepage instead of
  // the real form. Must run BEFORE the rewrite in section 3: the rewrite target
  // is internal and does NOT re-enter middleware, so it is never caught here.
  if (
    (staffSecret && pathname === STAFF_INTERNAL) ||
    (ownerSecret && pathname === OWNER_INTERNAL)
  ) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/", request.url))
    );
  }

  // ===== 3. Login pages: bounce logged-in users, else serve the form =====
  if (isOwnerLogin || isStaffLogin) {
    if (isAuthed) {
      const destination = role === "staff" ? "/admin/members" : "/admin";
      return applySecurityHeaders(
        NextResponse.redirect(new URL(destination, request.url))
      );
    }
    // Rewrite the secret path onto the internal route that renders the form.
    // The URL bar keeps showing the secret path; the internal name never
    // surfaces. With no secret configured (dev) the request is already on the
    // internal route, so just serve it.
    if (isOwnerLogin && ownerSecret) {
      return applySecurityHeaders(
        NextResponse.rewrite(new URL(OWNER_INTERNAL, request.url))
      );
    }
    if (isStaffLogin && staffSecret) {
      return applySecurityHeaders(
        NextResponse.rewrite(new URL(STAFF_INTERNAL, request.url))
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // ===== 4. Not authenticated + trying to reach /admin =====
  // Redirect to the homepage (not a login path) so probing /admin never
  // discloses where the login lives.
  if (pathname.startsWith("/admin") && !isAuthed) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/", request.url))
    );
  }

  // ===== 5. Staff hits /admin (dashboard) → send to /admin/members =====
  if (pathname === "/admin" && isAuthed && role === "staff") {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/admin/members", request.url))
    );
  }

  // ===== 6. Slide the session forward on admin activity =====
  // Re-issue the signed token and re-stamp last_activity on every admin
  // request, each with a fresh 3-day window. A user who keeps using the panel
  // never gets logged out; 3 days with no request does. `session` is the
  // already-verified payload, so this re-signs the same identity — no
  // privilege change.
  if (session && pathname.startsWith("/admin")) {
    const response = NextResponse.next();
    const freshToken = await createSessionToken(session);
    response.cookies.set(SESSION_COOKIE, freshToken, sessionCookieOptions());
    response.cookies.set("last_activity", Date.now().toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Must outlive SESSION_TIMEOUT_MS so the timestamp is still readable at
      // the moment the 3-day inactivity check runs.
      maxAge: 60 * 60 * 24 * 3 + 60 * 60, // 3 days + 1h
      path: "/",
      sameSite: "lax",
    });
    return applySecurityHeaders(response);
  }

  // ===== 7. All other requests get security headers too =====
  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // A single broad matcher is required because the secret login paths are
  // configured at runtime and cannot be listed here statically (the matcher is
  // analyzed at build time). Middleware runs on every request EXCEPT API
  // routes, Next internals, the static asset folders, and any path ending in a
  // file extension — so the webhook and static files are untouched.
  //
  // `monitoring` is Sentry's tunnel endpoint (tunnelRoute in next.config.ts).
  // Error reports are unauthenticated POSTs that carry no session, so running
  // them through session verification would be pure overhead — and an error
  // report must never depend on auth working, since broken auth is exactly the
  // kind of failure it needs to deliver.
  matcher: [
    "/((?!api/|monitoring|_next/|favicon.ico|images/|videos/|.*\\.[^/]+$).*)",
  ],
};
