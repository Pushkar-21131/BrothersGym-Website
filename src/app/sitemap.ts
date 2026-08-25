import type { MetadataRoute } from "next";

const SITE_URL = "https://brothersgym.in";

export default function sitemap(): MetadataRoute.Sitemap {
  const today = new Date();

  return [
    { url: SITE_URL, lastModified: today, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/join`, lastModified: today, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/contact`, lastModified: today, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, lastModified: today, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: today, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/refund`, lastModified: today, changeFrequency: "yearly", priority: 0.4 },
  ];
}