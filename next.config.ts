import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

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
      // Static media. This is the one place a long cache is worth the staleness
      // it buys, because the hero video is the largest thing the homepage
      // serves and it is on the critical path.
      //
      // Without this, a refresh revalidates: the browser has the bytes but
      // still spends a round trip asking whether they are current. max-age=86400
      // makes a same-day refresh a pure cache hit with no network at all, and
      // stale-while-revalidate keeps it that way afterwards — past a day the
      // browser serves the copy it already has and refreshes it in the
      // background. There is no case where a returning visitor waits on this.
      //
      // Deliberately not `immutable`. The filename is unhashed, so a year of
      // immutable caching would mean a replaced video never reaching anyone who
      // had already visited — and the video has been replaced twice already.
      // SWR keeps a replacement visible within about a day, which is the right
      // trade for a piece of scenery.
      {
        source: "/videos/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        // The <video> element names its poster by path, so that JPG is fetched
        // raw from here rather than through next/image. Same reasoning as above.
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },

  poweredByHeader: false,

  experimental: {
    serverActions: {
      // The bulk member import posts its parsed rows to a server action, and
      // Next's default body limit is 1 MB. 1,500 rows of JSON is roughly 450 KB,
      // so it fits today — but only just, and the failure would be an opaque 413
      // rather than anything the owner could act on. The import also sends in
      // chunks, so this is headroom rather than the mechanism.
      bodySizeLimit: "4mb",
    },
  },

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
  webpack: { treeshake: { removeDebugLogging: true } },
});
