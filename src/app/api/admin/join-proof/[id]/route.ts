/**
 * Serves one join request's payment screenshot to a logged-in admin.
 *
 * WHY A ROUTE AND NOT JUST THE COLUMN
 * The proof lives in the online_joins row as base64 (see db/schema.ts for why it
 * isn't in an object store). Selecting it into the admin page would put ~80KB of
 * base64 into the server-rendered HTML for every row — a 50-request page becomes
 * a 4MB document that the owner downloads on mobile data before seeing anything.
 * Streaming it from here instead means the list stays small and the browser only
 * fetches the images actually on screen.
 *
 * ACCESS
 * A payment screenshot shows a real person's UPI app: their name, their bank, the
 * last digits of their account. So this is gated on a verified session — not on
 * the URL being hard to guess — and the id is not a secret.
 *
 * Staff are allowed as well as the owner: the join-requests page is where a
 * front-desk person confirms payments, and there is no point letting them press
 * Confirm while hiding the evidence they are confirming against. A staff member
 * is held to their own branch, though — the id is sequential, so without that
 * check anyone at one branch could count upwards and read every other branch's
 * members' screenshots.
 *
 * DOWNLOAD
 * ?download=1 returns the same bytes under the same checks with an "attachment"
 * disposition, so the owner can keep a copy on their own laptop or phone before
 * clearing the image out of the database. That pairing is the point: retention is
 * bounded (see lib/join-proof-retention.ts) precisely because nothing is lost by
 * dropping a screenshot the owner already has.
 */

import { db } from "@/db";
import { onlineJoins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth-check";
import { ALLOWED_PROOF_MIMES, type ProofMime } from "@/lib/join-proof";

export const dynamic = "force-dynamic";

/**
 * Turn a member's name into something safe to put in a Content-Disposition
 * header and pleasant to find in a Downloads folder.
 *
 * Hard-restricted to ASCII letters, digits and dashes. The name is member-
 * supplied, so anything less strict risks a quote or a newline breaking out of
 * the header — and a filename is not worth a header-injection bug. Non-Latin
 * names can sanitize away to nothing, hence the caller's fallback.
 */
function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  // No redirect here: a redirect to /login inside an <img> renders as a broken
  // image with no explanation. A status code is what the client can act on.
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const joinId = Number(id);
  if (!Number.isInteger(joinId) || joinId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  // ?download=1 switches the disposition to "attachment" so the owner gets a
  // file on disk instead of an image in a tab. Same bytes, same access checks —
  // the only difference is the header, which is why it's a parameter here rather
  // than a second route.
  const wantsDownload = new URL(req.url).searchParams.get("download") === "1";

  try {
    const rows = await db
      .select({
        branchId: onlineJoins.branchId,
        name: onlineJoins.name,
        proofImage: onlineJoins.proofImage,
        proofMime: onlineJoins.proofMime,
      })
      .from(onlineJoins)
      .where(eq(onlineJoins.id, joinId))
      .limit(1);

    const row = rows[0];
    if (!row?.proofImage) return new Response("Not found", { status: 404 });

    // Staff see their own branch only; the owner sees every branch. 404 rather
    // than 403 so the response is identical to "no such request" — a staff
    // member shouldn't be able to map which ids exist elsewhere either.
    if (user.role !== "owner" && row.branchId !== user.branchId) {
      return new Response("Not found", { status: 404 });
    }

    // The stored MIME was sniffed from the bytes on upload, never taken from the
    // browser. Re-checking it against the allow-list here means even a row
    // written before that validation existed (or edited by hand in the database)
    // can't get an arbitrary Content-Type echoed back into the owner's browser.
    const stored = row.proofMime as ProofMime | null;
    const mime =
      stored && (ALLOWED_PROOF_MIMES as readonly string[]).includes(stored)
        ? stored
        : "image/jpeg";

    const body = Buffer.from(row.proofImage, "base64");

    const ext =
      mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    // Named so a folder of these is readable months later: the join id keeps it
    // unique and matches the reference in the admin list, the name is for the
    // human. Falls back to the id alone if the name sanitized away entirely.
    const slug = slugifyName(row.name || "");
    const filename = `brothers-gym-payment-${joinId}${slug ? `-${slug}` : ""}.${ext}`;

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(body.byteLength),
        // Belt and braces for a user-supplied image: never let a browser decide
        // it's HTML, and don't let it become a same-origin script/plugin host.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "Content-Disposition": `${
          wantsDownload ? "attachment" : "inline"
        }; filename="${filename}"`,
        // Private: this is one member's document, so no shared/CDN cache. The
        // image never changes once uploaded, so let the owner's own browser keep
        // it while they work through the list.
        "Cache-Control": "private, max-age=300, must-revalidate",
      },
    });
  } catch {
    return new Response("Failed", { status: 500 });
  }
}
