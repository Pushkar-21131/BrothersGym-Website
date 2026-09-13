import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// NO CONTENT-SECURITY-POLICY IN THIS FILE.
//
// It used to be here, with Razorpay's hosts spliced in unless
// PAYMENT_MODE=contact. But `headers()` below is evaluated ONCE, at build time,
// while layout.tsx decides whether to emit checkout.js by reading the same env
// var per request — so the kill switch was half build-time and half runtime, and
// building with the gateway off and then turning it on left a policy that
// silently blocked the checkout script. The policy now lives in
// `src/lib/csp.ts` and is emitted from `src/middleware.ts`, which runs on every
// document request. See the long note in that file.
//
// The headers that remain are constants, so build time is the right place for
// them — and unlike the CSP they still apply to the paths the middleware matcher
// skips (api routes, /_next, static assets), which is where `nosniff` and
// `X-Frame-Options` earn their keep.
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
