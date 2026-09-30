import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/lib/env-check";
import { Inter, Outfit } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

// Self-hosted via next/font so the first paint no longer waits on a
// render-blocking stylesheet from Google's font CDN. Only the /join page uses
// these (through globals.css), so their files aren't even downloaded on the
// homepage. Both are variable fonts — omitting `weight` ships the full range.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

const SITE_URL = "https://brothersgym.in";

// NO PRICES IN THIS FILE.
//
// The description, the OG card and the Twitter card all used to say "from
// ₹900/month". That was three copies of one number, in a file nobody opens when
// they change a plan in the admin panel, and all three were wrong — the cheapest
// plan is ₹1000 now. Worse, this is the ROOT layout: every page that does not
// override these inherits them, including pages that have no idea what a
// membership costs.
//
// The homepage, which already holds an ISR-cached database read, derives the
// figure and overrides all three in its own generateMetadata (src/app/page.tsx).
// Everything else inherits copy that makes no numeric claim at all.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // 58 characters. Google renders roughly 50-60 before it truncates, and the
    // previous default ran to 94 -- so the two things that decide whether this
    // result is the right one, the brand and the two neighbourhoods, were the
    // parts most likely to be cut. The homepage has no title of its own and
    // inherits this one, which makes it the single most valuable line in the
    // file; it is also the only title here that is not run through `template`.
    default: "Brothers Gym | Best Gym in Nangal Raya & Sagar Pur, Delhi",
    template: "%s | Brothers Gym",
  },
  // 154 characters. Same reasoning: the old one ran to 227, so a searcher saw
  // it clipped mid-clause. Every page that does not override this inherits it,
  // and the homepage overrides it with the live price (see page.tsx).
  description:
    "Brothers Gym: strength training, cardio and personal coaching at 2 gyms in West Delhi — Nangal Raya (Janakpuri) and Sagar Pur. Monthly to annual plans.",
  // No `keywords`. Google has ignored the meta keywords tag since around 2009
  // and it was never a ranking signal worth having. It was also inherited onto
  // /privacy, /terms and /refund, where sixteen locality terms on a refund
  // policy is nonsense, and it advertised an outdated practice to anyone
  // auditing the site. Removing it changes no ranking -- and that is the point:
  // it was doing nothing while looking like it did.
  authors: [{ name: "Brothers Gym", url: SITE_URL }],
  creator: "Brothers Gym",
  publisher: "Brothers Gym",
  applicationName: "Brothers Gym",
  category: "Health & Fitness",
  classification: "Gym, Fitness Center, Health Club",

  openGraph: {
    title: "Brothers Gym | Best Gym in Nangal Raya & Sagar Pur, Delhi",
    description:
      "Transform your body at Brothers Gym. Expert trainers, modern equipment, affordable memberships on flexible monthly plans. Two locations in West Delhi.",
    url: SITE_URL,
    siteName: "Brothers Gym",
    // No `images` here on purpose: src/app/opengraph-image.tsx generates the card
    // and Next wires it up automatically. Listing images here would override it
    // (the old entry pointed at /images/og-image.jpg, which does not exist).
    locale: "en_IN",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Brothers Gym - Best Gym in Delhi",
    description:
      "Premium fitness center with 2 locations in Delhi. Expert coaching and flexible memberships.",
    // Card comes from src/app/twitter-image.tsx — see the note above.
    creator: "@brothersgym12",
  },

  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  // NO `alternates.canonical` HERE, AND IT MUST NOT COME BACK.
  //
  // This is the root layout, so every segment inherits what is set here. A
  // canonical of SITE_URL therefore told Google that /join, /contact, /privacy,
  // /terms, /refund and /join/status -- six of the seven URLs in sitemap.ts --
  // were duplicates of the homepage. All six were submitted for indexing and
  // all six declared themselves copies of the seventh, so the site had exactly
  // one indexable URL. /join is the online join funnel and /contact is the only
  // page carrying both branches' full NAP, so the two most commercially useful
  // pages were the ones silencing themselves.
  //
  // A canonical belongs on a page, where it can be true. Every page under
  // src/app/ sets its own.

  // Only emitted once GOOGLE_SITE_VERIFICATION is set. The previous hardcoded
  // "your-google-verification-code" placeholder shipped a meta tag that could
  // never verify; an absent tag is strictly better than a wrong one.
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),

  // No geo.region / geo.placename / geo.position / ICBM.
  //
  // Google does not read them and Bing deprecated them, so they bought nothing.
  // What they cost was accuracy: this is the ROOT layout, so a single Nangal
  // Raya coordinate was asserted on every page of the site -- including
  // /privacy, /terms and /refund -- for a business with two branches three
  // kilometres apart, and it contradicted the `geo` in the homepage's own
  // structured data. Coordinates now live with their branch in the JSON-LD on
  // page.tsx, where each one is attached to the address it belongs to.
};

export const viewport = {
  themeColor: "#eab308",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Skipped only under PAYMENT_MODE=contact, where nothing on the site ever
  // talks to checkout.razorpay.com and the CSP doesn't allow it either. Matches
  // next.config.ts — both must agree, or we'd preconnect to a host the policy
  // then blocks.
  const razorpayMode = process.env.PAYMENT_MODE !== "contact";
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <head>
        {/* Fonts are self-hosted via next/font (see inter/outfit above), so
            there's no render-blocking request to Google's font CDN. */}
        {razorpayMode && (
          <>
            {/* Warm the TLS handshake to Razorpay's checkout host so the modal
                opens without a cold connection on the member's slowest tap. */}
            <link rel="preconnect" href="https://checkout.razorpay.com" />
            <link rel="dns-prefetch" href="https://checkout.razorpay.com" />
          </>
        )}

        {/* Favicon variants.
            The SVG stays first for browsers that take it — it is sharp at any
            size. The PNG is the fallback, and it is the only one that matters
            for apple-touch-icon: iOS ignores SVG there entirely, so "Add to
            Home Screen" used to produce a blank tile with a screenshot in it
            rather than the logo. */}
        <link rel="icon" href="/images/brothers-gym-logo.svg" type="image/svg+xml" />
        <link rel="icon" href="/images/brothers-gym-logo.png" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/images/brothers-gym-logo.png" />
      </head>
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}