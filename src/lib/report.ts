/**
 * Thin wrapper over Sentry's capture calls.
 *
 * Everything in the app reports through here rather than importing @sentry/nextjs
 * directly, so there is exactly one place that knows whether reporting is on and
 * exactly one place to change if it is ever swapped out.
 *
 * Every function here is a no-op when NEXT_PUBLIC_SENTRY_DSN is unset, which is
 * the normal state in local development.
 */
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED } from "@/lib/sentry-options";

/**
 * Report a caught error.
 *
 * `context` is attached as Sentry "extra" data — use it for the small facts that
 * make an error actionable (which branch, which plan, which join id). Never put
 * member names, phone numbers or emails in here; beforeSend scrubs the obvious
 * shapes but the cheapest PII leak is the one never written.
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!SENTRY_ENABLED) return;

  // Sentry groups Error instances by stack trace. Anything else (the Razorpay
  // SDK rejects with a plain object) would otherwise arrive as an unusable
  // "Non-Error exception captured", so wrap it first.
  const err =
    error instanceof Error
      ? error
      : new Error(
          typeof error === "string" ? error : safeStringify(error)
        );

  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Report something noteworthy that is not an exception — a webhook that failed
 * its signature check, a payment reconciliation that came back short. These are
 * the cases where nothing threw but someone still needs to know.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "warning",
  context?: Record<string, unknown>
): void {
  if (!SENTRY_ENABLED) return;
  Sentry.captureMessage(message, {
    level,
    ...(context ? { extra: context } : {}),
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structure.
    return String(value);
  }
}
