/**
 * Sanitizes error messages so we don't leak sensitive info
 * (database schema, file paths, stack traces) to users in production.
 */
import { captureError } from "@/lib/report";

/**
 * Pulls a human-readable message out of whatever was thrown.
 *
 * Not everything that gets thrown is an Error. The Razorpay SDK in particular
 * rejects with a PLAIN OBJECT shaped like:
 *   { statusCode: 400, error: { code, description, reason, field, source, step } }
 * Running String() on that returns the literal text "[object Object]", which is
 * what users were seeing on the join form instead of the real reason.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;

    // Razorpay: the useful text lives at error.error.description
    const inner = e.error;
    if (inner && typeof inner === "object") {
      const i = inner as Record<string, unknown>;
      if (typeof i.description === "string" && i.description) return i.description;
      if (typeof i.reason === "string" && i.reason) return i.reason;
    }

    if (typeof e.message === "string" && e.message) return e.message;
    if (typeof e.description === "string" && e.description) return e.description;

    // Last resort: JSON, so dev logs show something usable rather than
    // "[object Object]". Guarded because JSON.stringify throws on cycles.
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      /* circular structure — fall through */
    }
    return "";
  }

  return String(error ?? "");
}

export function sanitizeError(error: unknown, fallback = "Something went wrong"): string {
  // Log full error server-side (safe — logs go to server, not user)
  console.error("[Error]", error);

  // Also report it to Sentry. console.error alone goes into a rolling log
  // buffer nobody watches, so every caller of this function was a place where a
  // real bug became invisible. captureError is a no-op when the DSN is unset.
  captureError(error, { fallback });

  const message = extractMessage(error);

  // In dev, show real error for debugging
  if (process.env.NODE_ENV !== "production") {
    return message || fallback;
  }

  // ===== DATABASE AND RUNTIME WORDING NEVER REACHES THE USER =====
  // Checked BEFORE the allowlist below, and that order is the whole point: the
  // allowlist is a substring match, and Postgres words its errors in the same
  // vocabulary this file is trying to let through.
  //
  //   `/invalid/i`       passed `invalid input syntax for type integer: "NaN"`
  //                      straight to the join form — the exact text a NaN fee or
  //                      a mangled id produces. It names the database, the column
  //                      type and the offending value, and to a member it reads
  //                      as gibberish.
  //   `/already exists/i` would pass `relation "members" already exists`.
  //   `/not found/i`      would pass a driver's `ENOENT ... no such file` path.
  //
  // Matching on wording rather than on the error's type is deliberate: by the
  // time it arrives here `extractMessage` has already flattened Error objects,
  // Razorpay's envelope and raw JSON into a plain string, so the wording is all
  // that is left to test. These patterns are the vocabulary of the layers
  // underneath the app — none of them can occur in a message this codebase
  // writes for a member.
  const leakPatterns = [
    /invalid input (syntax|value)/i,
    /violates (unique|foreign key|not-null|check) constraint/i,
    /duplicate key value/i,
    /relation "|column "|constraint "/i,
    /syntax error at or near/i,
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|ENOENT|EACCES)\b/,
    /\b(postgres|postgresql|neon|drizzle|node_modules)\b/i,
    /[A-Za-z]:\\|\/(?:var|usr|home|app|tmp)\//, // filesystem paths
  ];

  if (leakPatterns.some((p) => p.test(message))) {
    return fallback;
  }

  // In production, only show safe messages
  const safePatterns = [
    /already exists/i,
    /not found/i,
    /invalid/i,
    /required/i,
    /must be/i,
    /unauthorized/i,
    /too many/i,
    /verification failed/i,
    /expired/i,
  ];

  // If the error message matches a safe pattern, allow it
  if (safePatterns.some((p) => p.test(message))) {
    return message;
  }

  // Otherwise, return generic message
  return fallback;
}