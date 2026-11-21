import { addMonthsIso, gymCycle } from "./utils";

export type LedgerKind = "payments" | "equipment";
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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function selectedDashboardCycle(value: unknown, today: string) {
  const current = gymCycle(today);
  if (!validReceivedDate(value, current.end) || value.slice(8) !== "15") return current;
  const selected = gymCycle(value);
  return selected.start <= current.start ? selected : current;
}

export function dashboardCycles(today: string, selectedStart: string) {
  const current = gymCycle(today);
  const cycles = Array.from({ length: 24 }, (_, index) => gymCycle(addMonthsIso(current.start, -index)));
  if (!cycles.some((cycle) => cycle.start === selectedStart)) cycles.push(gymCycle(selectedStart));
  return cycles;
}

export function cycleTitle(cycle: { start: string; end: string; label: string }) {
  return cycle.start.slice(0, 4) === cycle.end.slice(0, 4) ? `${cycle.label} ${cycle.end.slice(0, 4)}` : cycle.label;
}

export function dashboardHref(cycle: string, kind: LedgerKind = "payments", query = "", page = 1) {
  const params = new URLSearchParams({ cycle });
  if (kind !== "payments") params.set("type", kind);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/admin?${params}#transactions`;
}

export function paymentMethodLabel(method: string | null) {
  return ({ cash: "Cash", upi: "UPI", razorpay: "Online", other: "Other" } as Record<string, string>)[method ?? "cash"] ?? "Other";
}
