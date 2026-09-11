import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Sentry reports are POSTed to the project's ingest host, which the CSP has to
// allow or the browser blocks them silently — no console error, no report, and
// nothing to explain why the dashboard stays empty.
//
// The host is derived from the DSN so it matches whatever project is configured.
// With no DSN set (local dev) nothing is added to the policy at all.
const sentryIngestHost = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return "";
  try {
    return ` https://${new URL(dsn).host}`;
  } catch {
    // A malformed DSN shouldn't break the build — Sentry just stays off.
    return "";
  }
})();

// Razorpay's hosts are in the CSP unless PAYMENT_MODE=contact, which is the
// site-wide kill switch for online payments — in that one mode we drop every
// razorpay.com origin so the shipped policy carries no third-party payment hosts
// at all. Cloudflare (Turnstile captcha) and MSG91 stay regardless; they're
// unrelated to payments.
//
// NOTE: this is read at BUILD time, so flipping PAYMENT_MODE needs a redeploy,
// not just an env change. Defaulting to "gateway on" matters here: if an env var
// went missing and this fell through to the restrictive policy, checkout.js
// would be blocked by the CSP with nothing in the UI to explain it.
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

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(self)" },
          { key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // checkout.js also pulls its risk-detection bundle from
              // cdn.razorpay.com at runtime — both hosts are added via
              // rzpScript. Under PAYMENT_MODE=contact none of this is present.
              `script-src 'self' 'unsafe-inline' 'unsafe-eval'${rzpScript} https://challenges.cloudflare.com https://*.cloudflare.com`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data: https://fonts.gstatic.com",
              // lumberjack* are Razorpay's telemetry endpoints (dropped under
              // PAYMENT_MODE=contact via rzpConnect); control.msg91.com is the
              // SMS API.
              `connect-src 'self'${rzpConnect}${sentryIngestHost} https://challenges.cloudflare.com https://*.cloudflare.com https://control.msg91.com`,
              `frame-src 'self'${rzpFrame} https://challenges.cloudflare.com`,
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              `form-action 'self'${rzpForm}`,
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          }
        ],
      },
    ];
  },

  poweredByHeader: false,

  images: {
    // Serve the hero poster (the only next/image on the site so far) as AVIF or
    // WebP — both are dramatically smaller than the source JPG on browsers that
    // support them, which speeds up the largest paint element on the homepage.
    formats: ["image/avif", "image/webp"],
  },
};

/**
 * withSentryConfig does the build-time half of the integration: it uploads
 * source maps so a stack trace reads as `payments.ts:412` instead of
 * `main-a3f9.js:1:82910`, then deletes them from the deployed output so the
 * original source isn't downloadable from the site.
 *
 * The upload needs SENTRY_AUTH_TOKEN / org / project at BUILD time. Without
 * them the wrapper is inert and the build still succeeds — you just get
 * minified traces, which is why `silent` is off in CI: a skipped upload should
 * be visible in the build log, not swallowed.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet locally, loud in CI.
  silent: !process.env.CI,

  // Strip source maps from the client bundle after upload — they'd otherwise be
  // publicly fetchable and expose the whole codebase.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Sentry's ingest host is a common ad-blocker target; this proxies reports
  // through the site's own origin so blocked requests don't lose real errors.
  tunnelRoute: "/monitoring",

  // Drop the Sentry SDK's own debug logging from the production bundle.
  disableLogger: true,
});
