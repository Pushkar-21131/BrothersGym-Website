/**
 * Shared Sentry configuration.
 *
 * The three runtimes (browser, Node server, edge middleware) each need their own
 * Sentry.init() call, but the policy — what we send, what we scrub, when we stay
 * silent — should be identical everywhere. That policy lives here so it can't
 * drift between the three copies.
 *
 * Deliberately errors-only: no performance tracing, no session replay. This site
 * handles member names, phone numbers and payments, so the less that leaves the
 * server the better.
 */

/**
 * Reporting is opt-in via the DSN. No DSN set (local dev, or a deploy that
 * hasn't been given one) means Sentry.init() is skipped entirely rather than
 * running a no-op client, so nothing is sent and nothing is patched.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

export const SENTRY_ENABLED = SENTRY_DSN.length > 0;

/**
 * Options shared by every runtime.
 *
 * sendDefaultPii:false is the important one — it keeps Sentry from attaching IP
 * addresses, cookies and request headers to events. Combined with beforeSend
 * below, a report carries the stack trace and little else.
 */
export const sharedSentryOptions = {
  dsn: SENTRY_DSN,

  // Errors only. Tracing and replay are off, so these stay at zero.
  tracesSampleRate: 0,

  // Never attach IPs, cookies, or headers.
  sendDefaultPii: false,

  // Tag events by deploy context so a staging error can't be mistaken for a
  // real member hitting a bug in production.
  environment: process.env.NODE_ENV ?? "development",

  // Quiet in local dev — without this every `next dev` session would ship noise
  // to the same project the real site reports into.
  enabled: process.env.NODE_ENV === "production",
} as const;

/**
 * Error messages that are noise, not bugs.
 *
 * These are browser/extension artefacts and user-navigation races that fire
 * constantly on any public site. Left unfiltered they bury the real errors and
 * burn through the monthly quota.
 */
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  // Fired when a ResizeObserver callback outlives a frame. Chrome reports it as
  // an uncaught error; it is harmless and unfixable from our side.
  /ResizeObserver loop/i,
  // The user navigated away (or lost signal) mid-request. Not a site bug.
  /Failed to fetch/i,
  /NetworkError when attempting to fetch/i,
  /Load failed/i,
  /AbortError/i,
  // Browser extensions injecting scripts into the page.
  /extension:\//i,
  /chrome-extension/i,
  /moz-extension/i,
  // Next.js triggers this internally to unwind a redirect() — it is control
  // flow, not a failure, and would otherwise fire on every auth redirect.
  /NEXT_REDIRECT/,
  /NEXT_NOT_FOUND/,
];

function isIgnoredMessage(message: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((p) => p.test(message));
}

/**
 * Strings that look like member data, redacted before an event leaves the
 * process.
 *
 * sendDefaultPii:false already stops Sentry attaching PII on its own, but it
 * cannot help with PII we put into an error message ourselves — a thrown
 * "No member found for 9876543210" carries a real phone number in its text.
 * This scrubs the common Indian-phone and email shapes out of any message.
 */
function redactPii(input: string): string {
  return input
    // 10-digit Indian mobile numbers, with or without +91 / 0 prefix.
    .replace(/(?:\+?91[-\s]?|\b0)?[6-9]\d{9}\b/g, "[redacted-phone]")
    // Email addresses.
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[redacted-email]");
}

type SentryEventLike = {
  message?: string;
  request?: { url?: string; headers?: Record<string, string>; cookies?: unknown };
  user?: unknown;
  exception?: {
    values?: Array<{ value?: string; type?: string }>;
  };
};

/**
 * Last gate before an event is sent.
 *
 * Returning null drops the event. Everything else gets its message and
 * exception text scrubbed of anything phone- or email-shaped.
 */
export function beforeSend<T extends SentryEventLike>(event: T): T | null {
  const firstException = event.exception?.values?.[0];
  const rawMessage = firstException?.value ?? event.message ?? "";

  if (rawMessage && isIgnoredMessage(rawMessage)) return null;

  if (firstException?.value) {
    firstException.value = redactPii(firstException.value);
  }
  if (event.message) {
    event.message = redactPii(event.message);
  }

  // Strip identity and request metadata that may have been attached upstream.
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    // Query strings on this site carry join references and status tokens.
    if (event.request.url) {
      event.request.url = event.request.url.split("?")[0];
    }
  }

  return event;
}
