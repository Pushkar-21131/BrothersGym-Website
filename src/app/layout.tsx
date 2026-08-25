import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/lib/env-check";
import { Inter, Outfit } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import CookieConsent from "@/app/components/cookie-consent";

// Self-hosted via next/font so the first paint no longer waits on a
// render-blocking stylesheet from Google's font CDN. Only the /join page uses
// these (through globals.css), so their files aren't even downloaded on the
// homepage. Both are variable fonts — omitting `weight` ships the full range.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

const SITE_URL = "https://brothersgym.in";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "Brothers Gym - Best Gym in Nangal Raya & Sagar Pur, Delhi | Fitness & Personal Training",
    template: "%s | Brothers Gym",
  },
  description:
    "Brothers Gym offers premium fitness training, expert personal coaching, and modern equipment at 2 locations in Delhi — Nangal Raya (Janakpuri) & Sagar Pur. Join from ₹900/month with cardio & strength training options.",
  keywords: [
    "gym in nangal raya",
    "gym in sagar pur",
    "gym in janakpuri",
    "gym in west delhi",
    "brothers gym delhi",
    "personal training delhi",
    "fitness center janakpuri",
    "best gym near me",
    "affordable gym delhi",
    "bodybuilding gym delhi",
    "weight loss gym delhi",
    "gym membership online",
    "cardio gym delhi",
    "strength training gym",
    "gym near sagarpur",
    "gym near janakpuri",
  ],
  authors: [{ name: "Brothers Gym", url: SITE_URL }],
  creator: "Brothers Gym",
  publisher: "Brothers Gym",
  applicationName: "Brothers Gym",
  category: "Health & Fitness",
  classification: "Gym, Fitness Center, Health Club",

  openGraph: {
    title: "Brothers Gym - Premier Fitness Center in Delhi (2 Locations)",
    description:
      "Transform your body at Brothers Gym. Expert trainers, modern equipment, affordable memberships from ₹900/month. Two convenient locations in Delhi.",
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
      "Premium fitness center with 2 locations in Delhi. Join from ₹900/month.",
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

  alternates: {
    canonical: SITE_URL,
  },

  // Only emitted once GOOGLE_SITE_VERIFICATION is set. The previous hardcoded
  // "your-google-verification-code" placeholder shipped a meta tag that could
  // never verify; an absent tag is strictly better than a wrong one.
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),

  other: {
    "geo.region": "IN-DL",
    "geo.placename": "New Delhi",
    "geo.position": "28.6104029;77.1077599",
    ICBM: "28.6104029, 77.1077599",
  },
};

export const viewport = {
  themeColor: "#eab308",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <head>
        {/* Fonts are self-hosted via next/font (see inter/outfit above), so
            there's no render-blocking request to Google's font CDN. */}
        {/* Preconnect to external domains */}
        <link rel="preconnect" href="https://checkout.razorpay.com" />
        <link rel="dns-prefetch" href="https://checkout.razorpay.com" />

        {/* Favicon variants */}
        <link rel="icon" href="/images/brothers-gym-logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/images/brothers-gym-logo.svg" />
      </head>
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <Toaster position="bottom-right" />
        <CookieConsent />
      </body>
    </html>
  );
}