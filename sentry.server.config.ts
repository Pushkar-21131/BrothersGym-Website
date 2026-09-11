/**
 * Sentry — Node server runtime.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "nodejs". This is the one
 * that matters most: server actions (payments, joins, member writes) all run
 * here, and today their failures only reach console.error.
 */
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED, sharedSentryOptions, beforeSend } from "@/lib/sentry-options";

if (SENTRY_ENABLED) {
  Sentry.init({
    ...sharedSentryOptions,
    beforeSend,
  });
}
