import type { NextConfig } from "next";

// The online-join flow only reaches Razorpay's hosts when PAYMENT_MODE=razorpay.
// In the default manual-UPI mode we drop every razorpay.com origin from the CSP
// so the shipped policy has no third-party payment hosts at all. Cloudflare
// (Turnstile captcha) and MSG91 stay regardless — they're unrelated to payments.
const razorpayMode = process.env.PAYMENT_MODE === "razorpay";
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
              // In razorpay mode, checkout.js also pulls its risk-detection
              // bundle from cdn.razorpay.com at runtime — both hosts are added
              // via rzpScript. In manual mode none of this is present.
              `script-src 'self' 'unsafe-inline' 'unsafe-eval'${rzpScript} https://challenges.cloudflare.com https://*.cloudflare.com`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data: https://fonts.gstatic.com",
              // lumberjack* are Razorpay's telemetry endpoints (razorpay mode
              // only, via rzpConnect); control.msg91.com is the SMS API.
              `connect-src 'self'${rzpConnect} https://challenges.cloudflare.com https://*.cloudflare.com https://control.msg91.com`,
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

export default nextConfig;