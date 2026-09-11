import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { members, payments, equipmentExpenses, staff } from "@/db/schema";
import { sql, eq, and, lt, gte, inArray } from "drizzle-orm";
import {
  Users,
  Wrench,
  HandCoins,
  UserX,
  IndianRupee,
  AlertTriangle,
  ChevronRight,
  Building2,
} from "lucide-react";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getBranchStats(branchId: number, today: string, soon: string) {
  const [m, p, e, s, expired, expiring] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .where(eq(members.branchId, branchId)),
    db
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.branchId, branchId)),
    db
      .select({ total: sql<number>`coalesce(sum(${equipmentExpenses.cost}), 0)` })
      .from(equipmentExpenses)
      .where(eq(equipmentExpenses.branchId, branchId)),
    db
      .select({ salary: staff.salary })
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
  const totalStaffSalaries = s.reduce(
    (sum, item) => sum + (Number(item.salary) || 0),
    0
  );
  const expiredCount = Number(expired[0]?.count) || 0;
  const expiringCount = Number(expiring[0]?.count) || 0;
  const profit = totalRevenue - totalExpenses - totalStaffSalaries;

  return {
    totalMembers,
    totalRevenue,
    totalExpenses,
    totalStaffSalaries,
    profit,
    expiredCount,
    expiringCount,
  };
}

export default async function AdminDashboard() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");
  if (role !== "owner") {
    const canView = await hasPermission("dashboard", "canView");
    if (!canView) redirect("/admin/members");
  }

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const today = new Date().toISOString().split("T")[0];
  // Server component, rendered fresh on every request (force-dynamic), so
  // reading the clock here is the point rather than a purity problem.
  // eslint-disable-next-line react-hooks/purity
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  // Only the branches this account may see. Filtering BEFORE the stats queries
  // (rather than after) means a branch owner's dashboard never reads the other
  // gym's revenue at all — and nothing downstream can accidentally render it.
  const visibleBranches =
    scope.type === "single"
      ? allBranches.filter((b) => b.id === scope.branchId)
      : allBranches;

  const perBranchStats = await Promise.all(
    visibleBranches.map(async (b) => ({
      branch: b,
      stats: await getBranchStats(b.id, today, soon),
    }))
  );

  const combined = perBranchStats.reduce(
    (acc, r) => ({
      totalMembers: acc.totalMembers + r.stats.totalMembers,
      totalRevenue: acc.totalRevenue + r.stats.totalRevenue,
      totalExpenses: acc.totalExpenses + r.stats.totalExpenses,
      totalStaffSalaries: acc.totalStaffSalaries + r.stats.totalStaffSalaries,
      profit: acc.profit + r.stats.profit,
      expiredCount: acc.expiredCount + r.stats.expiredCount,
      expiringCount: acc.expiringCount + r.stats.expiringCount,
    }),
    {
      totalMembers: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      totalStaffSalaries: 0,
      profit: 0,
      expiredCount: 0,
      expiringCount: 0,
    }
  );

  const scopeLabel =
    scope.type === "single" ? scope.branchName : "All Branches";

  const outgoings = combined.totalExpenses + combined.totalStaffSalaries;
  const barTotal = combined.totalRevenue + outgoings;
  const revenueShare = barTotal > 0 ? (combined.totalRevenue / barTotal) * 100 : 0;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Dashboard</h1>
        <p className="adm-sub">
          Viewing <strong>{scopeLabel}</strong>
        </p>
      </div>

      {/* Two columns on a laptop, one on a phone. The split is by question:
          the left column answers "how is the business doing", the right one
          "where do I go next". Below 900px .adm-dash is not a grid, so the
          columns simply stack and the phone reads the same order it always
          did — hero, stats, money flow, branches, links. */}
      <div className="adm-dash">
        <div className="adm-dash-col">
      {/* Net profit is the one number worth opening the app for, so it gets
          the whole first screen. */}
      <section className="adm-hero">
        <div className="adm-hero-label">Net Profit · All Time</div>
        <div
          className={`adm-hero-value ${combined.profit >= 0 ? "pos" : "neg"}`}
        >
          {formatINR(combined.profit)}
        </div>

        <div className="adm-hero-meta">
          <div>
            <div className="adm-hero-meta-k">Revenue</div>
            <div className="adm-hero-meta-v" style={{ color: "var(--green2)" }}>
              {formatINR(combined.totalRevenue)}
            </div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Equipment</div>
            <div className="adm-hero-meta-v" style={{ color: "var(--red2)" }}>
              {formatINR(combined.totalExpenses)}
            </div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Salaries</div>
            <div className="adm-hero-meta-v" style={{ color: "var(--blue2)" }}>
              {formatINR(combined.totalStaffSalaries)}
            </div>
          </div>
        </div>
      </section>

      <div className="adm-qstats">
        <QStat
          tone="gold"
          icon={<Users size={14} />}
          value={String(combined.totalMembers)}
          label="Members"
        />
        <QStat
          tone="orange"
          icon={<AlertTriangle size={14} />}
          value={String(combined.expiringCount)}
          label="Expiring ≤7d"
        />
        <QStat
          tone="red"
          icon={<UserX size={14} />}
          value={String(combined.expiredCount)}
          label="Expired"
        />
        <QStat
          tone="green"
          icon={<IndianRupee size={14} />}
          value={formatINR(combined.totalRevenue)}
          label="Collected"
        />
      </div>

      {/* Money in vs money out. The proportion lands faster than two figures. */}
      <h2 className="adm-h2">Money Flow</h2>
      <section className="adm-card">
        <div className="adm-bar" aria-hidden="true">
          <div
            className="adm-bar-fill"
            style={{
              width: `${revenueShare}%`,
              background: "linear-gradient(90deg, var(--green), var(--green2))",
            }}
          />
          <div
            className="adm-bar-fill"
            style={{
              width: `${100 - revenueShare}%`,
              background: "linear-gradient(90deg, var(--red), var(--orange))",
            }}
          />
        </div>
        <div className="adm-bar-legend">
          <span>
            <i className="adm-dot" style={{ background: "var(--green)" }} />
            In {formatINR(combined.totalRevenue)}
          </span>
          <span>
            <i className="adm-dot" style={{ background: "var(--red)" }} />
            Out {formatINR(outgoings)}
          </span>
        </div>

        <div className="adm-kv" style={{ marginTop: 12 }}>
          <span className="adm-kv-k">Equipment expenses</span>
          <span className="adm-kv-v" style={{ color: "var(--red2)" }}>
            −{formatINR(combined.totalExpenses)}
          </span>
        </div>
        <div className="adm-kv">
          <span className="adm-kv-k">Staff salaries (monthly)</span>
          <span className="adm-kv-v" style={{ color: "var(--blue2)" }}>
            −{formatINR(combined.totalStaffSalaries)}
          </span>
        </div>
        <div className="adm-kv adm-kv-total">
          <span className="adm-kv-k" style={{ color: "var(--text)" }}>
            Net profit
          </span>
          <span
            className="adm-kv-v"
            style={{
              color: combined.profit >= 0 ? "var(--green2)" : "var(--red2)",
            }}
          >
            {formatINR(combined.profit)}
          </span>
        </div>
      </section>

        </div>

        <div className="adm-dash-col">
      {/* Per-branch breakdown, only when "All Branches" is selected. */}
      {scope.type === "all" && perBranchStats.length > 1 && (
        <>
          <h2 className="adm-h2">
            <Building2 size={13} />
            Per Branch
          </h2>
          <div className="adm-bscroll">
            {perBranchStats.map(({ branch, stats }) => (
              <article key={branch.id} className="adm-bcard">
                <div className="adm-bcard-head">
                  <span className="adm-bcard-name">{branch.name}</span>
                  <span className="adm-tag gold">{branch.code}</span>
                </div>
                <div className="adm-kv">
                  <span className="adm-kv-k">Members</span>
                  <span className="adm-kv-v">{stats.totalMembers}</span>
                </div>
                <div className="adm-kv">
                  <span className="adm-kv-k">Revenue</span>
                  <span className="adm-kv-v" style={{ color: "var(--green2)" }}>
                    {formatINR(stats.totalRevenue)}
                  </span>
                </div>
                <div className="adm-kv">
                  <span className="adm-kv-k">Equipment</span>
                  <span className="adm-kv-v" style={{ color: "var(--red2)" }}>
                    −{formatINR(stats.totalExpenses)}
                  </span>
                </div>
                <div className="adm-kv">
                  <span className="adm-kv-k">Salaries</span>
                  <span className="adm-kv-v" style={{ color: "var(--blue2)" }}>
                    −{formatINR(stats.totalStaffSalaries)}
                  </span>
                </div>
                <div className="adm-kv adm-kv-total">
                  <span className="adm-kv-k" style={{ color: "var(--text)" }}>
                    Net
                  </span>
                  <span
                    className="adm-kv-v"
                    style={{
                      color:
                        stats.profit >= 0 ? "var(--green2)" : "var(--red2)",
                    }}
                  >
                    {formatINR(stats.profit)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <h2 className="adm-h2">Jump To</h2>
      <section className="adm-card" style={{ padding: "4px 15px" }}>
        <Jump
          href="/admin/reminders"
          tone="orange"
          icon={<AlertTriangle size={15} />}
          title="Send expiry reminders"
          sub={`${combined.expiringCount} expiring in 7 days`}
        />
        <Jump
          href="/admin/inactive"
          tone="red"
          icon={<UserX size={15} />}
          title="Inactive members"
          sub={`${combined.expiredCount} expired or left`}
        />
        <Jump
          href="/admin/equipment"
          tone="blue"
          icon={<Wrench size={15} />}
          title="Equipment & servicing"
          sub={`${formatINR(combined.totalExpenses)} spent`}
        />
        <Jump
          href="/admin/staff"
          tone="purple"
          icon={<HandCoins size={15} />}
          title="Staff & salaries"
          sub={`${formatINR(combined.totalStaffSalaries)} per month`}
        />
      </section>
        </div>
      </div>
    </>
  );
}

function QStat({
  tone,
  icon,
  value,
  label,
}: {
  tone: string;
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="adm-qstat">
      <div className={`adm-qstat-icon tone-${tone}`}>{icon}</div>
      <div className="adm-qstat-v">{value}</div>
      <div className="adm-qstat-k">{label}</div>
    </div>
  );
}

function Jump({
  href,
  tone,
  icon,
  title,
  sub,
}: {
  href: string;
  tone: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Link href={href} className="adm-feed-row" style={{ alignItems: "center" }}>
      <span className={`adm-feed-icon tone-${tone}`}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span className="adm-feed-title" style={{ display: "block" }}>
          {title}
        </span>
        <span className="adm-feed-sub" style={{ display: "block" }}>
          {sub}
        </span>
      </span>
      <ChevronRight
        size={16}
        style={{ marginLeft: "auto", color: "var(--text3)", flex: "0 0 auto" }}
      />
    </Link>
  );
}
