import type { MetadataRoute } from "next";

const SITE_URL = "https://brothersgym.in";

/**
 * ONE group, on purpose.
 *
 * This file used to carry a second group naming GPTBot, ChatGPT-User,
 * Google-Extended, PerplexityBot and ClaudeBot, meant to welcome AI crawlers.
 * It did the opposite. Per RFC 9309 a crawler obeys only the most specific
 * group that matches it -- the `*` group is never merged in. So every agent
 * named there stopped inheriting this group's disallow list and got its own,
 * shorter one: it was free to fetch /forgot-password, /reset-password and
 * /_next/, which the wildcard group blocks. A named group can only narrow or
 * widen relative to itself; writing one at all is a promise to keep two lists
 * in agreement, and that is exactly what failed here.
 *
 * The intent is preserved below as a comment, where it cannot drift. All of
 * these are already allowed by `User-agent: * / Allow: /`:
 *
 *   Googlebot, Bingbot            search -- Bingbot also feeds ChatGPT Search
 *   OAI-SearchBot                 ChatGPT's search index
 *   GPTBot                        OpenAI model training
 *   PerplexityBot, Perplexity-User
 *   Google-Extended               Gemini training + Gemini/Vertex grounding.
 *                                 Allowing it does NOT affect AI Overviews,
 *                                 which are built by Googlebot from the Search
 *                                 index; it only governs the Gemini app, where
 *                                 we want to be citable.
 *   ClaudeBot, Claude-User, CCBot, Applebot-Extended, meta-externalagent
 *
 * If AI *training* is ever to be blocked while search stays open, that is the
 * change to make here -- one group per policy, each a deliberate exception to
 * this one, not a second copy of it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/join", "/join/status", "/contact", "/privacy", "/terms", "/refund"],
        // The login paths are intentionally omitted: they live behind secret,
        // env-configured URLs, and naming a path here would publish it to the
        // very crawlers we're hiding it from.
        //
        // "/_next/" is deliberately NOT disallowed, though it used to be.
        // Google's documentation says explicitly not to block CSS and JS:
        // Googlebot needs them to render a page the way a browser does, and
        // blocking them degrades its rendering assessment. This site is
        // server-rendered so the content survives without them -- which is why
        // the cost was modest, and also why there was never an upside.
        disallow: ["/admin/", "/api/", "/forgot-password", "/reset-password"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
