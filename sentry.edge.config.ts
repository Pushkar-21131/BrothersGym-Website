/**
 * Sentry — edge runtime.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "edge". src/middleware.ts
 * runs here, so auth/session failures in middleware report through this client.
 */
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED, sharedSentryOptions, beforeSend } from "@/lib/sentry-options";

if (SENTRY_ENABLED) {
  Sentry.init({
    ...sharedSentryOptions,
    beforeSend,
  });
}
