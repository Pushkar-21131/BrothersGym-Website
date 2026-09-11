/**
 * Validation for trainer photos uploaded through the admin panel.
 *
 * WHY THIS EXISTS SEPARATELY FROM join-proof.ts
 * The validation logic is nearly identical — closed MIME list, magic-byte sniff,
 * canonical re-encode — but the two have opposite threat models and opposite
 * lifetimes, and merging them would mean one set of constants serving both:
 *
 *   payment proof   private, one viewer (the owner), deleted within days,
 *                   must stay legible because an amount is read off it.
 *   trainer photo   PUBLIC, served to every visitor on the homepage, kept for
 *                   as long as the trainer works there, legibility irrelevant.
 *
 * The size ceiling is the sharp end of that difference. A proof is capped at
 * 300KB because it is transient; a photo that every homepage visitor downloads
 * has to be smaller, not larger, so it is capped tighter at 200KB even though it
 * is kept far longer.
 *
 * Like join-proof.ts this is deliberately NOT a "use server" module: it is called
 * from server actions and a route handler, and every export is a pure function,
 * so nothing here becomes a public endpoint.
 */

/**
 * The image types a trainer photo can arrive as.
 *
 * Same closed list as the payment proof, for the same reason: SVG passes a
 * `startsWith("image/")` test and is also a script-execution vector. That matters
 * more here than it does for a proof — this file is served to the public, not to
 * one logged-in owner, so an SVG that slipped through would be stored XSS
 * reachable by every visitor.
 */
export const ALLOWED_PHOTO_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type PhotoMime = (typeof ALLOWED_PHOTO_MIMES)[number];

/**
 * Ceiling on the DECODED photo, in bytes.
 *
 * The admin client downscales to 800px and re-encodes before upload, which puts a
 * normal portrait at 40–80KB. 200KB is generous headroom for that while keeping
 * the homepage honest: four trainers at 200KB is 800KB of images on a page a
 * member may open on mobile data.
 *
 * Tighter than MAX_PROOF_BYTES (300KB) on purpose — see the module docblock.
 */
export const MAX_PHOTO_BYTES = 200 * 1024;

/** Cheap pre-check on the base64 string, before spending memory decoding it. */
const MAX_PHOTO_BASE64_CHARS = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4096;

/**
 * Does the decoded buffer actually start like the format it claims?
 *
 * The browser-supplied MIME type is just a string the caller controls. Checking
 * the real signature is what stops a .svg or an .html being stored and then
 * served from our own origin with an image Content-Type.
 */
function sniffImageMime(buf: Buffer): PhotoMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Which image src to render for a trainer, or null for the placeholder icon.
 *
 * An uploaded photo beats a pasted URL. The owner uploading one is the more
 * recent, more deliberate act, and it is the source that cannot rot — a link can
 * 404 tomorrow, as all four of the original trainer links did.
 *
 * Takes photoMime rather than the image bytes on purpose, so a caller can decide
 * what to render without selecting base64 out of the database. Shared by the
 * public site, the admin list and the edit form so all three agree; a page that
 * picked differently would show the owner one photo while visitors saw another.
 */
export function resolveTrainerPhoto(t: {
  id: number;
  photoMime: string | null;
  photoUrl: string | null;
}): string | null {
  if (t.photoMime) return `/api/trainer-photo/${t.id}`;
  return t.photoUrl || null;
}

export type PhotoValidation =
  | { ok: true; base64: string; mime: PhotoMime; bytes: number }
  | { ok: false; error: string };

/**
 * Validate a base64 trainer photo arriving from the admin form.
 *
 * Accepts either a bare base64 string or a full `data:image/...;base64,...` URL,
 * because that is what canvas.toDataURL() produces. The MIME that comes back is
 * the SNIFFED one, never the claimed one — so what gets stored, and later served
 * to the public, always matches the actual bytes.
 *
 * Error strings here are written for the gym owner, not a member: they say what
 * to do about it rather than apologising.
 */
export function validatePhotoImage(
  raw: string | undefined | null
): PhotoValidation {
  const input = (raw || "").trim();
  if (!input) return { ok: false, error: "Please choose a photo first." };

  // Strip a data-URL prefix if present. [\s\S] rather than `.` with the /s flag:
  // dotAll needs an ES2018 target and this project builds to ES2017.
  let base64 = input;
  const dataUrl = input.match(/^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i);
  if (dataUrl) base64 = dataUrl[2];
  base64 = base64.replace(/\s/g, "");

  if (base64.length > MAX_PHOTO_BASE64_CHARS) {
    return {
      ok: false,
      error: "That photo is too large. Please choose a smaller one.",
    };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: "That file isn't a valid image." };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "That file isn't a valid image." };
  }

  if (buf.length === 0) {
    return { ok: false, error: "That file is empty. Please choose a photo." };
  }
  if (buf.length > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: `That photo is too large (max ${Math.floor(
        MAX_PHOTO_BYTES / 1024
      )}KB after compression). Please choose a smaller one.`,
    };
  }

  const mime = sniffImageMime(buf);
  if (!mime) {
    return { ok: false, error: "That file isn't a JPG, PNG or WebP image." };
  }

  // Re-encode from the decoded buffer so what is stored is canonical base64 with
  // no data-URL prefix, whitespace or alternate padding.
  return { ok: true, base64: buf.toString("base64"), mime, bytes: buf.length };
}
