/**
 * Sentry — server and edge runtimes.
 *
 * Next.js calls register() once per runtime at startup. The dynamic imports are
 * required: the Node and edge SDKs must not be loaded into the wrong runtime, so
 * each is pulled in only when process.env.NEXT_RUNTIME says it belongs.
 *
 * onRequestError is what turns an uncaught server error into a Sentry event —
 * without it, App Router swallows server-side render errors.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
