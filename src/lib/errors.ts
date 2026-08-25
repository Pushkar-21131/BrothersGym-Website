/**
 * Sanitizes error messages so we don't leak sensitive info
 * (database schema, file paths, stack traces) to users in production.
 */

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

  const message = extractMessage(error);

  // In dev, show real error for debugging
  if (process.env.NODE_ENV !== "production") {
    return message || fallback;
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