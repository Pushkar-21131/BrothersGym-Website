import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { isHistoryEnabled } from "@/lib/history-release";
import DashboardTransactions from "./dashboard-transactions";
import { cycleTitle, dashboardCycles, dashboardHref, LEDGER_PAGE_SIZE, selectedDashboardCycle, type LedgerKind } from "@/lib/dashboard-finance";
import { dashboardTransactions } from "@/lib/dashboard-transactions";
import { formatDateIn } from "@/lib/whatsapp";
import { members, payments, equipmentExpenses, staff } from "@/db/schema";
import { sql, eq, and, lt, gte, lte, isNull } from "drizzle-orm";
import {
  Users,
  Wrench,
  HandCoins,
  UserX,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  History,
} from "lucide-react";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { requireOwner } from "@/lib/auth-check";
import {
  formatINR,
  istDateString,
  addDaysIso,
  gymCycle,
  salaryPayday,
  addMonthsIso,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getBranchStats(
  branchId: number,
  today: string,
  soon: string,
  cycle: { start: string; end: string }
) {
  const [m, p, e, s, expired, expiring] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .where(eq(members.branchId, branchId)),
    // Removed entries are excluded: the owner took them out of the timeline
    // because the money was never taken, so counting them here would put a total
    // on the dashboard that the member list cannot account for. Same filter as
    // the member's history — see the note on the column in schema.ts.
    //
    // Dated to the cycle, like the spending below: every money figure on this
    // page answers "what did this month do", never "what have we ever done".
    db
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
        paymentCount: sql<number>`count(*)`,
        cash: sql<number>`coalesce(sum(case when ${payments.method} = 'cash' or ${payments.method} is null then ${payments.amount} else 0 end), 0)`,
        upi: sql<number>`coalesce(sum(case when ${payments.method} = 'upi' then ${payments.amount} else 0 end), 0)`,
        online: sql<number>`coalesce(sum(case when ${payments.method} = 'razorpay' then ${payments.amount} else 0 end), 0)`,
        other: sql<number>`coalesce(sum(case when ${payments.method} not in ('cash', 'upi', 'razorpay') then ${payments.amount} else 0 end), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.branchId, branchId),
          isNull(payments.voidedAt),
          gte(payments.date, cycle.start),
          lte(payments.date, today < cycle.end ? today : cycle.end)
        )
      ),
    db
      .select({ total: sql<number>`coalesce(sum(${equipmentExpenses.cost}), 0)` })
      .from(equipmentExpenses)
      .where(
        and(
          eq(equipmentExpenses.branchId, branchId),
          gte(equipmentExpenses.date, cycle.start),
          lte(equipmentExpenses.date, today < cycle.end ? today : cycle.end)
        )
      ),
    // Who has been paid inside this cycle — which is not the whole roster. The
    // salary is charged from the person's own payday (the day of the month they
    // joined), so a cycle that opened yesterday carries nobody's wages yet.
    db
      .select({ salary: staff.salary, joinDate: staff.joinDate })
      .from(staff)
      .where(and(eq(staff.branchId, branchId), eq(staff.isActive, true))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .where(
        and(eq(members.branchId, branchId), lt(members.membershipExpiry, today))
      ),
    // Expiring inside the next 7 days — the number that decides who gets a
    // WhatsApp reminder today.
    db
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .where(
        and(
          eq(members.branchId, branchId),
          gte(members.membershipExpiry, today),
          lt(members.membershipExpiry, soon)
        )
      ),
  ]);

  const totalMembers = Number(m[0]?.count) || 0;
  const totalRevenue = Number(p[0]?.total) || 0;
  const totalExpenses = Number(e[0]?.total) || 0;
  // Paid once the payday has arrived, not before: on the 16th of a cycle that
  // opened on the 15th this is nobody, which is the number the owner can check
  // against his own pocket.
  const salariesDue = s.reduce(
    (sum, item) =>
      salaryPayday(item.joinDate, cycle) <= (today < cycle.end ? today : cycle.end) && salaryPayday(item.joinDate, cycle) >= item.joinDate
        ? sum + (Number(item.salary) || 0)
        : sum,
    0
  );
  const expiredCount = Number(expired[0]?.count) || 0;
  const expiringCount = Number(expiring[0]?.count) || 0;
  const profit = totalRevenue - totalExpenses - salariesDue;

  return {
    totalMembers,
    totalRevenue,
    paymentCount: Number(p[0]?.paymentCount) || 0,
    cash: Number(p[0]?.cash) || 0,
    upi: Number(p[0]?.upi) || 0,
    online: Number(p[0]?.online) || 0,
    other: Number(p[0]?.other) || 0,
    totalExpenses,
    salariesDue,
    profit,
    expiredCount,
    expiringCount,
  };
}

export default async function AdminDashboard({ searchParams }: {
  searchParams: Promise<{ cycle?: string; type?: string; q?: string; page?: string }>;
}) {
  await requireOwner();

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  // Server component, rendered fresh on every request (force-dynamic), so
  // reading the clock here is the point rather than a purity problem. IST, not
  // UTC: on Vercel the host runs in UTC, and a UTC date would call a membership
  // "expired" from 6:30 PM the evening before.
  const today = istDateString();
  const soon = addDaysIso(today, 7);

  // Every money figure on this page covers the gym's own month, 15th → 14th.
  // The owner counts a month's takings and a month's spending across that
  // boundary, so the calendar month is the wrong window for both.
  const params = await searchParams;
  const currentCycle = gymCycle(today);
  const cycle = selectedDashboardCycle(params.cycle, today);
  const kind: LedgerKind = params.type === "equipment" ? "equipment" : "payments";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const requestedPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const receivedThrough = today < cycle.end ? today : cycle.end;

  // Only the branches this account may see. Filtering BEFORE the stats queries
  // (rather than after) means a branch owner's dashboard never reads the other
  // gym's revenue at all — and nothing downstream can accidentally render it.
  const visibleBranches =
    scope.type === "single"
      ? allBranches.filter((b) => b.id === scope.branchId)
      : allBranches;

  const [perBranchStats, ledger] = await Promise.all([
    Promise.all(visibleBranches.map(async (b) => ({
      branch: b,
      stats: await getBranchStats(b.id, today, soon, cycle),
    }))),
    dashboardTransactions(visibleBranches.map((b) => b.id), cycle.start, receivedThrough, kind, query, page),
  ]);
  const pages = Math.max(1, Math.ceil(ledger.total / LEDGER_PAGE_SIZE));
  if (page > pages) redirect(dashboardHref(cycle.start, kind, query, pages));

  const combined = perBranchStats.reduce(
    (acc, r) => ({
      totalMembers: acc.totalMembers + r.stats.totalMembers,
      totalRevenue: acc.totalRevenue + r.stats.totalRevenue,
      paymentCount: acc.paymentCount + r.stats.paymentCount,
      cash: acc.cash + r.stats.cash,
      upi: acc.upi + r.stats.upi,
      online: acc.online + r.stats.online,
      other: acc.other + r.stats.other,
      totalExpenses: acc.totalExpenses + r.stats.totalExpenses,
      salariesDue: acc.salariesDue + r.stats.salariesDue,
      profit: acc.profit + r.stats.profit,
      expiredCount: acc.expiredCount + r.stats.expiredCount,
      expiringCount: acc.expiringCount + r.stats.expiringCount,
    }),
    {
      totalMembers: 0,
      totalRevenue: 0,
      paymentCount: 0,
      cash: 0,
      upi: 0,
      online: 0,
      other: 0,
      totalExpenses: 0,
      salariesDue: 0,
      profit: 0,
      expiredCount: 0,
      expiringCount: 0,
    }
  );

  const scopeLabel =
    scope.type === "single" ? scope.branchName : "All Branches";

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Dashboard</h1>
        <p className="adm-sub"><strong>{scopeLabel}</strong> · collections and costs</p>
      </div>
      <form className="adm-finance-cycle" method="get" action="/admin">
        <div className="adm-finance-cycle-field">
          <label className="adm-label" htmlFor="dashboard-cycle">Profit cycle · 15th to 14th</label>
          <select id="dashboard-cycle" name="cycle" defaultValue={cycle.start} className="adm-select">
            {dashboardCycles(today, cycle.start).map((item) => <option key={item.start} value={item.start}>
              {cycleTitle(item)}{item.start === currentCycle.start ? " · Current" : ""}
            </option>)}
          </select>
        </div>
        <input type="hidden" name="type" value={kind} />
        <button type="submit" className="adm-btn primary">View cycle</button>
        <div className="adm-finance-cycle-nav">
          <Link href={dashboardHref(addMonthsIso(cycle.start, -1), kind).split("#")[0]} className="adm-btn" aria-label="Previous profit cycle"><ChevronLeft size={16} /></Link>
          {cycle.start < currentCycle.start
            ? <Link href={dashboardHref(addMonthsIso(cycle.start, 1), kind).split("#")[0]} className="adm-btn" aria-label="Next profit cycle"><ChevronRight size={16} /></Link>
            : <button type="button" className="adm-btn" disabled aria-label="Next profit cycle"><ChevronRight size={16} /></button>}
        </div>
        {cycle.start !== currentCycle.start && <Link href="/admin" className="adm-btn">Current cycle</Link>}
      </form>
      <div className="adm-finance-layout">
        <section className="adm-finance-statement" aria-labelledby="profit-title">
          <h2 id="profit-title">Net profit</h2>
          <p className={"adm-finance-profit" + (combined.profit < 0 ? " negative" : "")}>{formatINR(combined.profit)}</p>
          <p className="adm-finance-period">{cycleTitle(cycle)}</p>
          <p className="adm-finance-period-status">{cycle.end < today ? "Completed cycle" : "In progress"} · receipts through {formatDateIn(receivedThrough)}</p>
          <dl className="adm-finance-breakdown">
            <div><dt>Membership collections</dt><dd>{formatINR(combined.totalRevenue)}</dd></div>
            <div><dt>Equipment expenses</dt><dd>−{formatINR(combined.totalExpenses)}</dd></div>
            <div><dt>Scheduled payroll</dt><dd>−{formatINR(combined.salariesDue)}</dd></div>
          </dl>
          <Link href={dashboardHref(cycle.start)} className="adm-btn primary adm-finance-review">
            Review {combined.paymentCount} {combined.paymentCount === 1 ? "payment" : "payments"} <ChevronRight size={15} />
          </Link>
          <div className="adm-finance-methods">
            <h3>Collections by method</h3>
            <dl>
              <div><dt>Cash</dt><dd>{formatINR(combined.cash)}</dd></div>
              <div><dt>UPI</dt><dd>{formatINR(combined.upi)}</dd></div>
              <div><dt>Online</dt><dd>{formatINR(combined.online)}</dd></div>
              <div><dt>Other</dt><dd>{formatINR(combined.other)}</dd></div>
            </dl>
          </div>
          <p className="adm-finance-footnote">Scheduled payroll uses the current active staff rates and their join-date paydays.</p>
        </section>
        <DashboardTransactions key={cycle.start + ":" + kind + ":" + query} rows={ledger.rows} total={ledger.total}
          page={page} pages={pages} kind={kind} cycle={cycle.start} query={query} today={today} showBranch={scope.type === "all"} />
      </div>
      <section className="adm-finance-health" aria-labelledby="gym-today-title">
        <h2 id="gym-today-title">Gym today</h2>
        <p>Membership status as of {formatDateIn(today)}, across {scopeLabel}.</p>
        <div>
          <Link href="/admin/members"><Users size={17} /><strong>{combined.totalMembers}</strong><span>Members</span><ChevronRight size={14} /></Link>
          <Link href="/admin/reminders"><AlertTriangle size={17} /><strong>{combined.expiringCount}</strong><span>Expiring in 7 days</span><ChevronRight size={14} /></Link>
          <Link href="/admin/inactive"><UserX size={17} /><strong>{combined.expiredCount}</strong><span>Expired memberships</span><ChevronRight size={14} /></Link>
        </div>
      </section>
      {scope.type === "all" && perBranchStats.length > 1 && <section className="adm-finance-branches">
        <h2>Accounts by branch</h2>
        <div className="adm-table-wrap">
          <table className="adm-table"><thead><tr><th>Branch</th><th>Collections</th><th>Equipment</th><th>Payroll</th><th>Net profit</th></tr></thead>
            <tbody>{perBranchStats.map(({ branch, stats }) => <tr key={branch.id}>
              <td>{branch.name}</td><td>{formatINR(stats.totalRevenue)}</td><td>{formatINR(stats.totalExpenses)}</td><td>{formatINR(stats.salariesDue)}</td><td>{formatINR(stats.profit)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      <h2 className="adm-h2 adm-finance-manage-title">Manage this gym</h2>
      <section className="adm-card">
        {isHistoryEnabled() && <Jump href="/admin/history" icon={<History size={16} />} title="History" sub="See who changed a payment or expense" />}
        <Jump href="/admin/members" icon={<Users size={16} />} title="Members & renewals" sub="Renew a membership or update member details" />
        <Jump href="/admin/equipment" icon={<Wrench size={16} />} title="Equipment expenses" sub="Record a purchase, repair or servicing cost" />
        <Jump href="/admin/staff" icon={<HandCoins size={16} />} title="Staff & salaries" sub="Review current rates and scheduled paydays" />
      </section>
    </>
  );
}

function Jump({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return <Link href={href} className="adm-feed-row">
    <span className="adm-feed-icon tone-gold">{icon}</span>
    <span className="adm-finance-jump-text"><span className="adm-feed-title">{title}</span><span className="adm-feed-sub">{sub}</span></span>
    <ChevronRight size={16} />
  </Link>;
}
