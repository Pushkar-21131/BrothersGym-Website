import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Calendar dates, in India, as "YYYY-MM-DD".
 *
 * `new Date().toISOString().split("T")[0]` gives the UTC date, not the local
 * one. India is UTC+5:30, so between midnight and 5:30 AM IST that string is
 * *yesterday*. Every join taken in that window — a real window, the gyms open
 * at 5:30 AM — was stamped with the previous day's joining date and a
 * membership one day short.
 *
 * The server's own clock is not the answer either: Vercel runs in UTC, so a
 * date derived from the host is wrong there no matter what a local `npm run
 * dev` shows. Asia/Kolkata is named explicitly so the result is the same
 * everywhere.
 *
 * These columns are Postgres `date`, which Drizzle hands back as a plain
 * "YYYY-MM-DD" string. Keeping the arithmetic in that form — never round-
 * tripping through a Date — is why `addDaysIso` exists: a Date carries a time
 * of day that has no meaning for a calendar column and only creates new ways
 * for a timezone to shift it.
 */
const IST_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function istDateString(d: Date = new Date()): string {
  // formatToParts rather than the formatted string: it does not depend on the
  // locale putting the year first or using "-" as the separator.
  const parts = IST_DATE_FORMAT.formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Add whole days to a "YYYY-MM-DD" date, returning "YYYY-MM-DD".
 *
 * UTC internally on purpose: it is a fixed offset with no DST, so "+30 days"
 * is always exactly 30 days. Using local time here would make the result
 * depend on the server's timezone, which is the bug this file exists to avoid.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split("T")[0];
}