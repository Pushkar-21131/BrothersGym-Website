/**
 * Serves an uploaded trainer photo to anyone.
 *
 * PUBLIC ON PURPOSE — the one real difference from the payment-proof route
 * next door, which gates everything on a verified session. These photos render on
 * the homepage and the trainers tab, so a logged-out visitor has to be able to
 * fetch them. There is nothing private here: a gym publishes its trainers.
 *
 * That inverts the caching too. A payment proof is one member's document, so it
 * is `private` with a 5-minute window; a trainer photo is the same bytes for every
 * visitor and changes maybe once a year, so it wants a long shared/CDN cache.
 *
 * WHY A ROUTE AND NOT THE COLUMN
 * Same reason as the join proof: the bytes are base64 in the trainers row (see
 * db/schema.ts for why there is no object store), and selecting them into the
 * homepage would put ~60KB of base64 per trainer into the server-rendered HTML of
 * the most-visited page on the site. The queries read photoMime instead and let
 * the browser fetch the images it actually needs, in parallel, cached.
 */

import { db } from "@/db";
import { trainers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ALLOWED_PHOTO_MIMES, type PhotoMime } from "@/lib/trainer-photo";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const trainerId = Number(id);
  if (!Number.isInteger(trainerId) || trainerId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const rows = await db
      .select({
        photoImage: trainers.photoImage,
        photoMime: trainers.photoMime,
      })
      .from(trainers)
      .where(eq(trainers.id, trainerId))
      .limit(1);

    const row = rows[0];
    if (!row?.photoImage) return new Response("Not found", { status: 404 });

    // The stored MIME was sniffed from the bytes on upload, never taken from the
    // browser. Re-checking it against the allow-list here means even a row
    // written before that validation existed (or edited by hand in the database)
    // can't get an arbitrary Content-Type served from our own origin — which on a
    // public route would be reachable by every visitor, not just the owner.
    const stored = row.photoMime as PhotoMime | null;
    const mime =
      stored && (ALLOWED_PHOTO_MIMES as readonly string[]).includes(stored)
        ? stored
        : "image/jpeg";

    const body = Buffer.from(row.photoImage, "base64");

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(body.byteLength),
        // Belt and braces for an uploaded image: never let a browser decide it's
        // HTML, and don't let it become a same-origin script/plugin host.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        // Long and shared, unlike the payment proof's `private, max-age=300`.
        // stale-while-revalidate is what makes a photo swap show up without
        // anyone purging a cache: the next visitor after an edit still gets the
        // old bytes instantly, and the fetch behind them refreshes it.
        //
        // The URL is /api/trainer-photo/<id> with no version in it, so a replaced
        // photo can take up to a day to reach a browser that already cached one.
        // For a page that changes annually that is the right trade against making
        // every visitor re-download 60KB per trainer.
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("Failed", { status: 500 });
  }
}
