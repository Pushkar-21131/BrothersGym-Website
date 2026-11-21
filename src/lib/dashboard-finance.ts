import { addDaysIso, addMonthsIso, gymCycle } from "./utils";

export type LedgerKind = "payments" | "equipment";
export type DashboardPeriod = { start: string; end: string };
export const LEDGER_PAGE_SIZE = 25;

export type DashboardPayment = {
  kind: "payment";
  id: number;
  memberName: string | null;
  gymId: number | null;
  planType: string | null;
  amount: number;
  date: string;
  method: string | null;
  recordedDate: string | null;
  branchCode: string | null;
  canCorrectDate: boolean;
};

export type DashboardExpense = {
  kind: "equipment";
  id: number;
  equipmentName: string;
  amount: number;
  date: string;
  createdByName: string | null;
  branchCode: string | null;
};

export type DashboardTransaction = DashboardPayment | DashboardExpense;

export function validReceivedDate(value: unknown, today: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || value > today) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dashboardPeriodError(start: unknown, end: unknown, today: string) {
  if (!validReceivedDate(start, today)) return "Choose a valid start date on or before today.";
  if (!validReceivedDate(end, "9999-12-31")) return "Choose a valid end date.";
  if (end < start) return "End date must be on or after start date.";
  return null;
}

export function selectedDashboardPeriod(start: unknown, end: unknown, today: string, legacyCycle?: unknown) {
  const current = gymCycle(today);
  const fallback = { start: current.start, end: current.end };
  if (start === undefined && end === undefined) {
    // Previously shared cycle links still open the same dates.
    const legacy = validReceivedDate(legacyCycle, current.start) && legacyCycle.slice(8) === "15" ? gymCycle(legacyCycle) : current;
    return { period: { start: legacy.start, end: legacy.end }, error: null };
  }
  const error = dashboardPeriodError(start, end, today);
  return { period: error ? fallback : { start: start as string, end: end as string }, error };
}

export function periodTitle(period: DashboardPeriod) {
  const formatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const start = formatter.format(new Date(`${period.start}T00:00:00Z`));
  return period.start === period.end ? start : `${start} – ${formatter.format(new Date(`${period.end}T00:00:00Z`))}`;
}

export function scheduledSalaryInPeriod(joinDate: string, salary: number, period: DashboardPeriod, today: string) {
  if (!validReceivedDate(joinDate, today) || !Number.isFinite(salary) || salary <= 0) return 0;
  const start = joinDate > period.start ? joinDate : period.start;
  const end = today < period.end ? today : period.end;
  if (start > end) return 0;
  const payday = Number(joinDate.slice(8));
  let total = 0;
  for (let month = `${start.slice(0, 7)}-01`; month <= end; month = addMonthsIso(month, 1)) {
    const lastDay = Number(addDaysIso(addMonthsIso(month, 1), -1).slice(8));
    const due = `${month.slice(0, 8)}${String(Math.min(payday, lastDay)).padStart(2, "0")}`;
    if (due >= start && due <= end) total += salary;
  }
  return total;
}

export function dashboardSummaryHref(period: DashboardPeriod) {
  return `/admin?${new URLSearchParams({ from: period.start, to: period.end })}`;
}

export function dashboardHref(period: DashboardPeriod, kind: LedgerKind = "payments", query = "", page = 1) {
  const params = new URLSearchParams({ from: period.start, to: period.end, review: "1" });
  if (kind !== "payments") params.set("type", kind);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/admin?${params}#transactions`;
}

export function paymentMethodLabel(method: string | null) {
  return ({ cash: "Cash", upi: "UPI", razorpay: "Online", other: "Other" } as Record<string, string>)[method ?? "cash"] ?? "Other";
}
