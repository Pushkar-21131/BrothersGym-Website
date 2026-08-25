import type { MetadataRoute } from "next";

const SITE_URL = "https://brothersgym.in";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/join", "/contact", "/privacy", "/terms", "/refund"],
        // The login paths are intentionally omitted: they live behind secret,
        // env-configured URLs, and naming a path here would publish it to the
        // very crawlers we're hiding it from. /admin/ still 404s to visitors.
        disallow: [
          "/admin/",
          "/api/",
          "/forgot-password",
          "/reset-password",
          "/_next/",
        ],
      },
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Google-Extended", "PerplexityBot", "ClaudeBot"],
        allow: ["/", "/join", "/contact", "/privacy", "/terms", "/refund"],
        disallow: ["/admin/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}