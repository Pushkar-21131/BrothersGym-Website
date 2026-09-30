import { ImageResponse } from "next/og";
import { getPlanPricing } from "@/lib/plan-pricing";

/**
 * Social share card (WhatsApp, Facebook, Instagram DMs, Twitter).
 *
 * Generated at build time instead of shipping a hand-made JPG: the previous
 * metadata pointed at /images/og-image.jpg, which does not exist, so every
 * shared link rendered with no preview at all.
 */
export const alt = "Brothers Gym — Nangal Raya & Sagar Pur, West Delhi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Regenerated hourly so the figure below tracks the membership_plans rows like
// every other price on the site, instead of being baked in permanently.
//
// Caveat worth knowing: WhatsApp, Facebook and X cache a share image on their
// own schedule, often for weeks, so a repriced plan can still show the old card
// in a chat for a while. Nothing here can override that. It is still a clear
// improvement on what used to be here — a hardcoded "Rs. 900" that had been
// wrong since the cheapest plan became Rs. 1,200.
export const revalidate = 3600;

export default async function OpenGraphImage() {
  // A pricing lookup that fails must not fail the build or blank the card. The
  // fallback names no figure at all, which is the same choice the homepage makes
  // when no plan is priced.
  const pricing = await getPlanPricing().catch(() => null);

  // "Rs." rather than ₹: the OG renderer can't fetch a font containing the rupee
  // glyph and falls back to an empty box.
  const tagline = pricing
    ? `Two Brothers. One Standard. Memberships from Rs. ${pricing.monthlyMin.toLocaleString("en-IN")}/month.`
    : "Two Brothers. One Standard. Memberships for every goal.";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #09090b 0%, #18181b 55%, #27272a 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#eab308",
            fontWeight: 700,
          }}
        >
          Nangal Raya · Sagar Pur · West Delhi
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 104,
            fontWeight: 900,
            letterSpacing: -2,
            textTransform: "uppercase",
            color: "#ffffff",
            lineHeight: 1,
          }}
        >
          Brothers
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 104,
            fontWeight: 900,
            letterSpacing: -2,
            textTransform: "uppercase",
            color: "#eab308",
            lineHeight: 1,
          }}
        >
          Gym
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 34,
            fontSize: 34,
            color: "#d4d4d8",
          }}
        >
          {tagline}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 48,
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#eab308",
              color: "#09090b",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: "uppercase",
              padding: "14px 30px",
              borderRadius: 12,
            }}
          >
            Join Online
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#71717a" }}>
            brothersgym.in
          </div>
        </div>
      </div>
    ),
    size
  );
}
