/**
 * Regenerates src/lib/checkout-logo.ts from the master logo SVG.
 *
 * Run with:  node scripts/gen-checkout-logo.js
 *
 * See the header of the generated file for why the Razorpay checkout logo is an
 * inline data URI rather than a URL under /public.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "images", "brothers-gym-logo.svg");
const OUT = path.join(__dirname, "..", "src", "lib", "checkout-logo.ts");
const SIZE = 128;

const header = `/**
 * Brothers Gym logo as an inline data URI, for Razorpay Checkout only.
 *
 * WHY INLINE AND NOT A URL
 * Razorpay renders Checkout in an iframe on its own HTTPS origin and loads this
 * image from there, not from our page. A URL therefore has to be publicly
 * reachable over HTTPS — which http://localhost:3000 is not, so in local
 * development the logo silently fell back to a letter tile (a bare "B"). Their
 * docs allow a base64 string precisely for the case where the image is not
 * loaded from a network, so this works identically on localhost, on Netlify
 * deploy previews and in production, with nothing to configure.
 *
 * ${SIZE}x${SIZE} PNG on a white matte: the tile renders around 48px, the source SVG
 * already paints a near-white background (so a transparent PNG would look wrong
 * against Razorpay orange), and SVG is not an option — Checkout rasterises this
 * into a tile and ignores image/svg+xml.
 *
 * GENERATED FILE — do not hand-edit. After changing the logo, run:
 *   node scripts/gen-checkout-logo.js
 */
export const CHECKOUT_LOGO_DATA_URI =
  "`;

sharp(SRC, { density: 300 })
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer()
  .then((buf) => {
    const uri = `data:image/png;base64,${buf.toString("base64")}`;
    fs.writeFileSync(OUT, `${header}${uri}";\n`, "utf8");
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
    console.log(`${SIZE}px png: ${buf.length} bytes -> data URI ${uri.length} chars`);
  })
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
