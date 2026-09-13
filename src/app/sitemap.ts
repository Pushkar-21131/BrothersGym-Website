import type { MetadataRoute } from "next";

const SITE_URL = "https://brothersgym.in";

// Fixed dates, not `new Date()`. Stamping build time on every URL told Google
// the refund policy changed today on every deploy, which is a lie it learns to
// ignore. Bump the relevant constant when you actually change that content.
const CONTENT_UPDATED = "2026-09-12"; // homepage, join flow, contact details
const LEGAL_UPDATED = "2026-09-12"; // privacy, terms, refund

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: CONTENT_UPDATED, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/join`, lastModified: CONTENT_UPDATED, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/join/status`, lastModified: CONTENT_UPDATED, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified: CONTENT_UPDATED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/refund`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.4 },
  ];
}