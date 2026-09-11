/**
 * Sentry — browser runtime.
 *
 * Next.js loads this file automatically on the client (the instrumentation-client
 * convention); it is not imported anywhere by hand. Anything referenced here ends
 * up in the client bundle, so it stays deliberately small.
 */
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED, sharedSentryOptions, beforeSend } from "@/lib/sentry-options";

if (SENTRY_ENABLED) {
  Sentry.init({
    ...sharedSentryOptions,
    beforeSend,
    // Errors only: no browserTracingIntegration, no replayIntegration.
    integrations: [],
  });
}

/**
 * Lets Sentry tie an error to the route the user was moving to when App Router
 * navigations happen. Next.js calls this hook itself; it carries no timing data
 * with tracing off.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
