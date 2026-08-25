import { redirect } from "next/navigation";

/**
 * Catch-all for any URL that matches no real route — a mistyped path, an old
 * bookmarked link, a random probe, or a leftover reference like the former
 * /brothers-owner-2020.
 *
 * Every real page is a more specific match and takes precedence over this
 * catch-all: the homepage, /join, /contact, the legal pages
 * (/privacy, /terms, /refund), /forgot-password, /reset-password, /admin and
 * its sub-pages, and the login routes. So only genuinely unknown paths land
 * here — and they're sent to the homepage instead of showing a 404.
 *
 * (The secret login paths are rewritten to their internal route by middleware
 * before routing runs, so they never reach this catch-all either.)
 */
export default function CatchAllRedirect() {
  redirect("/");
}
