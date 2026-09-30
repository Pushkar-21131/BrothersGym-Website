/**
 * Generates the circular tab icon (and the iOS home-screen tile) from the master
 * logo SVG.
 *
 * Run with:  node scripts/gen-favicon.js
 *
 * WHY A CROP AND NOT A REDRAW
 * The master logo is a full circular badge: "BROTHERSGYM" lettering around a dark
 * ring, with the two flexed arms on a gold disc in the middle. At 16px in a tab
 * the lettering is illegible noise, and the thing that actually reads is the gold
 * disc. So the disc is what the favicon is: the geometry is measured off the
 * master file rather than eyeballed, and the source of truth stays the one SVG.
 *
 * WHY PNG AND NOT SVG
 * The master SVG is a traced illustration — 259 paths, 222 KB. A true vector
 * favicon would mean re-emitting a subset of those paths, and getting that
 * subset wrong produces a subtly broken mark that nobody notices until it is on
 * a customer's screen. Rasterising the vector at high resolution and downsampling
 * to each target size is exact, and a gold disc with two dark arms is not
 * something that suffers at these sizes. Every link tag points at a PNG as a
 * result; there is no SVG favicon, deliberately.
 */

const sharp = require("sharp");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "images", "brothers-gym-logo.svg");
const OUT_DIR = path.join(__dirname, "..", "public", "images");

// Rendered once, large, purely to measure the disc and to provide something to
// downsample from. Density 120 turns the 1254px artwork into ~2090px.
const REF_DENSITY = 120;

// The site's near-black. Used behind the iOS tile, which cannot have transparent
// corners: iOS composites transparency onto black and then applies its own
// rounded-rect mask, so a bare transparent PNG turns into a black square with a
// gold blob on it.
const BRAND_DARK = { r: 10, g: 13, b: 20, alpha: 1 };

const ICONS = [
  { file: "favicon-16.png", size: 16 },
  { file: "favicon-32.png", size: 32 },
  { file: "favicon-48.png", size: 48 },
];

// The disc gets a hair of the black ring around it. Not for looks — at 32px a
// 1% margin is a third of a pixel. It is so the circular mask lands on ring
// rather than slicing through the anti-aliased gold/black seam, which would
// leave a ragged edge all the way round.
const CROP_MARGIN = 1.02;

/** Warm, bright, blue-suppressed — the gold of the disc and nothing else. */
const isGold = (r, g, b) => r > 140 && r - b > 50 && g - b > 30;

/**
 * Find the gold disc's centre and radius.
 *
 * Not a bounding box, and not a ray cast along the centre line either. Both were
 * tried and both are wrong here, in ways that produce a plausible-looking number:
 *
 *  - A bbox of "everything that isn't white" measures the whole badge, lettering
 *    and stars included.
 *  - A ray cast inward along the centre ROW runs straight into the black stars
 *    that sit on the ring at exactly mid-height.
 *  - A ray cast inward along the centre COLUMN runs into the two fists, which
 *    cross the middle; and its far end picked up a stray warm pixel two dozen
 *    rows below the disc, which inflated the diameter by 4%.
 *
 * What is actually reliable: on any row the arms do not reach, the gold forms
 * exactly ONE unbroken run, and that run's two ends are points on the disc's
 * edge. That gets us the upper arc cleanly.
 *
 * The lower half does not work, and it is worth saying why, because the numbers
 * there look fine until you check them: below the fists the arms still cover the
 * disc's left and right edges, so the gold run is cut short by the arms rather
 * than by the disc. A row at y=1630 measures 660px across where the circle
 * predicts 517. Fitting those rows drags the centre down and the radius up.
 *
 * So: fit the upper arc only, then reject outliers and refit. Writing the circle
 * equation as hw² + y² = (R² − cy²) + 2·cy·y makes it linear in y, so an
 * ordinary regression gives cy from the slope and R from the intercept.
 */
function measureDisc(data, width, height, channels) {
  const rows = [];

  for (let y = 0; y < height; y++) {
    let first = -1;
    let last = -1;
    let runs = 0;
    let inRun = false;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const gold = isGold(data[i], data[i + 1], data[i + 2]);
      if (gold && !inRun) {
        runs++;
        inRun = true;
        if (first < 0) first = x;
      } else if (!gold && inRun) {
        inRun = false;
      }
      if (gold) last = x;
    }

    if (runs !== 1) continue; // the arms cut this row into pieces
    const hw = (last - first) / 2;
    if (hw < 5) continue; // the extreme tip of the disc, too few pixels to trust
    rows.push({ y, cx: (first + last) / 2, hw });
  }

  if (rows.length < 20) {
    throw new Error(
      `Only ${rows.length} clean rows found — is the master logo still the badge?`
    );
  }

  // The clean arc is the stretch running down from the top of the disc over
  // which the gold keeps widening. Where it ends is not "the widest row" —
  // measured that way the widest single-run row sits at y=1439, BELOW the arms,
  // because the arms split every row through the middle of the disc into
  // several runs and those rows are already gone. Instead: walk down and stop
  // at the first sudden collapse in width. Below the arms the gold survives only
  // as narrow slivers between the fists, so the width falls off a cliff there —
  // 604px to 5px — and the walk stops cleanly on its own.
  let runningMax = 0;
  let cut = rows.length;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hw < runningMax * 0.95) {
      cut = i;
      break;
    }
    if (rows[i].hw > runningMax) runningMax = rows[i].hw;
  }
  let points = rows.slice(0, cut);
  if (points.length < 100) {
    throw new Error(`Clean arc is only ${points.length} rows — the fit would be guesswork.`);
  }

  const fit = (pts) => {
    const n = pts.length;
    const meanY = pts.reduce((a, p) => a + p.y, 0) / n;
    const meanZ = pts.reduce((a, p) => a + p.hw * p.hw + p.y * p.y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      const dy = p.y - meanY;
      sxy += dy * (p.hw * p.hw + p.y * p.y - meanZ);
      sxx += dy * dy;
    }
    const slope = sxy / sxx;
    const cy = slope / 2;
    return { cy, r: Math.sqrt(meanZ - slope * meanY + cy * cy), n };
  };

  // One rejection pass, to shed the anti-aliased tip of the arc, which is a few
  // pixels wide and reads slightly wide. Two passes collapsed the fit onto a
  // 29-row cap the last time this was tried, so there is only one.
  let model = fit(points);
  const keep = points.filter(
    (p) => Math.abs(Math.hypot(p.hw, p.y - model.cy) - model.r) < model.r * 0.015
  );
  if (keep.length > 100) {
    points = keep;
    model = fit(points);
  }

  const worst = Math.max(
    ...points.map((p) => Math.abs(Math.hypot(p.hw, p.y - model.cy) - model.r))
  );
  if (worst > model.r * 0.015) {
    throw new Error(
      `Circle fit is poor: worst residual ${worst.toFixed(1)}px of r=${model.r.toFixed(1)}`
    );
  }

  const cx = points.reduce((a, p) => a + p.cx, 0) / points.length;
  const spread = Math.max(...points.map((p) => Math.abs(p.cx - cx)));
  if (spread > model.r * 0.02) {
    throw new Error(`Disc centre drifts by ${spread.toFixed(1)}px horizontally — not a circle.`);
  }

  return { cx, cy: model.cy, r: model.r, rows: points.length, worst, dropped: rows.length - points.length };
}

/** A white disc, used as a `dest-in` mask so the crop comes out circular. */
const discMask = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );

async function main() {
  const ref = await sharp(SRC, { density: REF_DENSITY })
    .resize(2090, 2090, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const disc = measureDisc(ref.data, ref.info.width, ref.info.height, ref.info.channels);
  console.log(
    `disc: centre ${disc.cx.toFixed(1)},${disc.cy.toFixed(1)}  radius ${disc.r.toFixed(1)}  ` +
      `(fit on ${disc.rows} rows, worst residual ${disc.worst.toFixed(2)}px, ` +
      `${disc.dropped} arm-contaminated rows dropped)`
  );

  const cropR = Math.round(disc.r * CROP_MARGIN);
  const card = await sharp(ref.data, { raw: ref.info })
    .extract({
      left: Math.round(disc.cx - cropR),
      top: Math.round(disc.cy - cropR),
      width: cropR * 2,
      height: cropR * 2,
    })
    .png()
    .toBuffer();

  for (const { file, size } of ICONS) {
    await sharp(card)
      .resize(size, size, { fit: "cover" })
      .composite([{ input: discMask(size), blend: "dest-in" }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, file));
    console.log(`  wrote ${file}  ${size}x${size}`);
  }

  // iOS tile: opaque, inset, on the brand's near-black.
  const TILE = 180;
  const INNER = Math.round(TILE * 0.84);
  const inner = await sharp(card)
    .resize(INNER, INNER, { fit: "cover" })
    .composite([{ input: discMask(INNER), blend: "dest-in" }])
    .png()
    .toBuffer();
  await sharp({ create: { width: TILE, height: TILE, channels: 4, background: BRAND_DARK } })
    .composite([{ input: inner, gravity: "centre" }])
    .flatten({ background: BRAND_DARK })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, "apple-icon.png"));
  console.log(`  wrote apple-icon.png  ${TILE}x${TILE} (disc at ${INNER}px on brand dark)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
