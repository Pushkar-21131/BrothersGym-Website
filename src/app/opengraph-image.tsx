import { ImageResponse } from "next/og";

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

export default async function OpenGraphImage() {
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
          {/* "Rs." rather than ₹: the OG renderer can't fetch a font containing
              the rupee glyph and falls back to an empty box. */}
          Two Brothers. One Standard. Memberships from Rs. 900/month.
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
