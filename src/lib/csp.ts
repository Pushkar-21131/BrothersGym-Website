/**
 * The Content-Security-Policy, built per request.
 *
 * WHY THIS IS NOT IN next.config.ts ANY MORE
 * `headers()` in next.config.ts is evaluated once, at build time. The policy has
 * to name Razorpay's hosts, and whether it should is decided by `PAYMENT_MODE` —
 * the site-wide kill switch for online payments. So the switch was half
 * build-time and half runtime, and the two halves disagreed in the dangerous
 * direction:
 *
 *   built with PAYMENT_MODE=contact, then flipped to razorpay
 *     → layout.tsx reads the env var per request and emits checkout.js,
 *       but the baked policy has no razorpay origin, so the browser blocks the
 *       script. Silently: no console message the owner will see, no error in the
 *       UI, just a checkout that never opens.
 *
 * Emitting the policy from middleware puts both halves on the same clock. The
 * env var is read here, on the request, so the kill switch takes effect on the
 * next page load on any host that supplies environment variables to middleware
 * at runtime (Vercel does). Where a host bakes them in instead, this is no worse
 * than the build-time version it replaces.
 *
 * Edge-safe: string building and `new URL`, nothing from Node.
 */
export function buildContentSecurityPolicy(): string {
  // Sentry reports are POSTed to the project's ingest host, which the policy has
  // to allow or the browser blocks them silently — no console error, no report,
  // and nothing to explain why the dashboard stays empty. Derived from the DSN so
  // it matches whatever project is configured; with no DSN (local dev) nothing is
  // added at all.
  let sentryIngestHost = "";
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    try {
      sentryIngestHost = ` https://${new URL(dsn).host}`;
    } catch {
      // A malformed DSN shouldn't cost us a policy — Sentry just stays off.
    }
  }

  // Razorpay's hosts are present unless PAYMENT_MODE=contact, where we drop every
  // razorpay.com origin so the served policy carries no third-party payment host
  // at all. Cloudflare (Turnstile captcha) and MSG91 stay regardless; they are
  // unrelated to payments.
  //
  // Defaulting to "gateway on" matters: if the env var went missing and this fell
  // through to the restrictive policy, checkout.js would be blocked by the CSP
  // with nothing in the UI to explain it. Same default as env-check.ts,
  // layout.tsx and join/page.tsx, all of which read it the same way.
  const razorpayMode = process.env.PAYMENT_MODE !== "contact";
  const rzpScript = razorpayMode
    ? " https://checkout.razorpay.com https://cdn.razorpay.com https://*.razorpay.com"
    : "";
  const rzpConnect = razorpayMode
    ? " https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com https://*.razorpay.com"
    : "";
  const rzpFrame = razorpayMode
    ? " https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com"
    : "";
  const rzpForm = razorpayMode ? " https://api.razorpay.com" : "";

  return [
    "default-src 'self'",
    // checkout.js also pulls its risk-detection bundle from cdn.razorpay.com at
    // runtime — both hosts are added via rzpScript. Under PAYMENT_MODE=contact
    // none of this is present.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${rzpScript} https://challenges.cloudflare.com https://*.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https://fonts.gstatic.com",
    // lumberjack* are Razorpay's telemetry endpoints (dropped under
    // PAYMENT_MODE=contact via rzpConnect); control.msg91.com is the SMS API.
    `connect-src 'self'${rzpConnect}${sentryIngestHost} https://challenges.cloudflare.com https://*.cloudflare.com https://control.msg91.com`,
    `frame-src 'self'${rzpFrame} https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${rzpForm}`,
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
