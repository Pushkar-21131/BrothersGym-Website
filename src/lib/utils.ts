export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * A member's number as the owner writes it: a cardio member keeps the register's
 * C, so M.No 1295 of the cardio tier prints as "C-1295".
 *
 * The database holds the number and the tier in two columns — the register holds
 * them in one — so this spelling exists to make the app and the sheet agree line
 * for line. It is derived on the way out, never stored: parseGymId() reads
 * "C-1295" straight back to 1295 plus the cardio flag, so an export re-imports.
 */
export function formatGymId(gymId: number, planType: string | null): string {
  return planType === "full" ? `C-${gymId}` : String(gymId);
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

/** This request's instant in ms — see inactive/page.tsx for why it is passed down. */
export function requestNow(d: Date = new Date()): number {
  return d.getTime();
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

export type RenewalStart = "today" | "due_date";

/**
 * Renewals keep any remaining membership days. For an expired membership, the
 * owner can count continued attendance by extending from the previous due date.
 * Shared by the renewal preview and the server; payment dates stay separate.
 */
export function getMembershipRenewalDates(
  currentExpiry: string,
  durationDays: number,
  renewalStart: RenewalStart = "today",
  today: string = istDateString()
): { startDate: string; newExpiry: string } {
  const startDate =
    renewalStart === "due_date" || currentExpiry > today ? currentExpiry : today;
  return { startDate, newExpiry: addDaysIso(startDate, durationDays) };
}

/**
 * Add whole months, returning "YYYY-MM-DD".
 *
 * Only ever called on a cycle start, and the 15th exists in every month, so the
 * day-of-month overflow a general "add a month" has (31 Jan → 3 Mar) cannot
 * arise here. UTC for the same reason `addDaysIso` is.
 */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().split("T")[0];
}

/**
 * The gym's month runs 15th → 14th. The owner counts a month's takings and
 * spending from the 15th to the 14th, so the calendar month is the wrong window
 * for every money figure — a round of salaries and a month of dues both land
 * across the boundary.
 */
export const CYCLE_START_DAY = 15;

const CYCLE_DAY_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function cycleDay(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  const formatted = CYCLE_DAY_FORMAT.format(new Date(Date.UTC(y, m - 1, d)));
  return withYear ? `${formatted} ${y}` : formatted;
}

/**
 * The cycle containing `isoDate`, as an inclusive "YYYY-MM-DD" range.
 *
 * Day >= 15 opens the cycle that month; day <= 14 is still inside the one that
 * opened on the previous 15th. The end is derived — step to the next cycle and
 * back a day — rather than written as "the 14th", so 31-day months, February and
 * leap years fall out of the arithmetic instead of a table of special cases.
 */
export function gymCycle(
  isoDate: string,
  startDay: number = CYCLE_START_DAY
): { start: string; end: string; label: string } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const opensThisMonth = `${y}-${pad(m)}-${pad(startDay)}`;
  const start = d >= startDay ? opensThisMonth : addMonthsIso(opensThisMonth, -1);
  const end = addDaysIso(addMonthsIso(start, 1), -1);

  // The year is dropped unless the cycle straddles one, where "15 Dec → 14 Jan"
  // would leave the reader to guess which year's January.
  const withYear = start.slice(0, 4) !== end.slice(0, 4);
  return {
    start,
    end,
    label: `${cycleDay(start, withYear)} → ${cycleDay(end, withYear)}`,
  };
}

/**
 * The day a staff member's salary lands inside `cycle`.
 *
 * There is no salary-payment record to read: the roster holds one monthly figure
 * per person, and the day of the month it is paid is the day that person joined.
 * So a cycle's wage bill is not the whole roster — it is the people whose payday
 * has arrived in it — which is what stops a cycle that opened yesterday from
 * being charged a month of wages nobody has been paid yet.
 *
 * Days 15 and later fall in the month that opened the cycle, days 1-14 in the
 * month that closes it, so a 15th-to-14th cycle holds exactly one payday per
 * person and a full cycle still comes to one month's wages.
 */
export function salaryPayday(
  joinDate: string,
  cycle: { start: string; end: string }
): string {
  const day = Number(joinDate.slice(8, 10));
  const month =
    day >= Number(cycle.start.slice(8, 10))
      ? cycle.start.slice(0, 7)
      : cycle.end.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  // A 31st payday has to land somewhere in a 30-day month, and the last day is
  // the only answer that keeps it inside the cycle.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}
