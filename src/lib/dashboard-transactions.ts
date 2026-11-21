import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, equipmentExpenses, members, payments } from "@/db/schema";
import { istDateString } from "./utils";
import { LEDGER_PAGE_SIZE, type DashboardTransaction, type LedgerKind } from "./dashboard-finance";

// Only called by the owner page, with branch ids obtained from getBranchScope().
export async function dashboardTransactions(branchIds: number[], start: string, end: string, kind: LedgerKind, query: string, page: number) {
  const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const gymSearch = /^c[\s-]*\d+$/i.test(query) ? `%${query.replace(/^c[\s-]*/i, "")}%` : search;
  if (kind === "equipment") {
    const filter = and(inArray(equipmentExpenses.branchId, branchIds), gte(equipmentExpenses.date, start), lte(equipmentExpenses.date, end),
      query ? or(ilike(equipmentExpenses.equipmentName, search), ilike(equipmentExpenses.createdByName, search)) : undefined);
    const [rows, totals] = await Promise.all([
      db.select({ id: equipmentExpenses.id, equipmentName: equipmentExpenses.equipmentName, amount: equipmentExpenses.cost,
        date: equipmentExpenses.date, createdByName: equipmentExpenses.createdByName, branchCode: branches.code })
        .from(equipmentExpenses).leftJoin(branches, eq(equipmentExpenses.branchId, branches.id)).where(filter)
        .orderBy(desc(equipmentExpenses.date), desc(equipmentExpenses.id)).limit(LEDGER_PAGE_SIZE).offset((page - 1) * LEDGER_PAGE_SIZE),
      db.select({ total: count() }).from(equipmentExpenses).where(filter),
    ]);
    return { rows: rows.map((row): DashboardTransaction => ({ ...row, kind: "equipment" })), total: Number(totals[0]?.total ?? 0) };
  }
  const filter = and(inArray(payments.branchId, branchIds), isNull(payments.voidedAt), gte(payments.date, start), lte(payments.date, end),
    query ? or(ilike(members.name, search), ilike(sql`${members.gymId}::text`, gymSearch)) : undefined);
  const [rows, totals] = await Promise.all([
    db.select({ id: payments.id, memberName: members.name, gymId: members.gymId, planType: members.planType, amount: payments.amount, date: payments.date,
      method: payments.method, createdAt: payments.createdAt, branchCode: branches.code,
      gatewayOrderId: payments.razorpayOrderId, gatewayPaymentId: payments.razorpayPaymentId })
      .from(payments).leftJoin(members, eq(payments.memberId, members.id)).leftJoin(branches, eq(payments.branchId, branches.id))
      .where(filter).orderBy(desc(payments.date), desc(payments.id)).limit(LEDGER_PAGE_SIZE).offset((page - 1) * LEDGER_PAGE_SIZE),
    db.select({ total: count() }).from(payments).leftJoin(members, eq(payments.memberId, members.id)).where(filter),
  ]);
  return { rows: rows.map((row): DashboardTransaction => ({ kind: "payment", id: row.id, memberName: row.memberName,
    gymId: row.gymId, planType: row.planType, amount: row.amount, date: row.date, method: row.method, branchCode: row.branchCode,
    recordedDate: row.createdAt ? istDateString(row.createdAt) : null,
    canCorrectDate: !row.gatewayOrderId && !row.gatewayPaymentId,
  })), total: Number(totals[0]?.total ?? 0) };
}
