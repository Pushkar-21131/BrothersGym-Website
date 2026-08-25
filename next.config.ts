import type { NextConfig } from "next";

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
              // checkout.js pulls in its risk-detection bundle from cdn.razorpay.com
              // at runtime. Without it listed the script is blocked and checkout
              // logs a CSP violation on every load.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com https://*.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data: https://fonts.gstatic.com",
              // lumberjack* are Razorpay's telemetry endpoints; blocking them
              // produces console noise during an otherwise successful payment.
              "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com https://*.cloudflare.com https://control.msg91.com",
              "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://api.razorpay.com",
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