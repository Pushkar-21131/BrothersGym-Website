import Link from "next/link";
import { redirect } from "next/navigation";
import { History, Users, RefreshCw, Wrench, UserRound, ChevronLeft, ChevronRight } from "lucide-react";
import { and, count, desc, eq, gte, inArray, isNull, like, lte, not, or } from "drizzle-orm";
import { db, pool } from "@/db";
import { activityLogs, branches } from "@/db/schema";
import { requireOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { ACTIVITY_LABELS, getHistoryRange, HISTORY_PAGE_SIZE, HISTORY_PERIODS, type HistoryPeriod } from "@/lib/activity-history";
import { DELETE_EXPIRED_ACTIVITY_SQL } from "@/lib/activity-retention";
import RefreshHistory from "./refresh-history";
import { isHistoryEnabled } from "@/lib/history-release";

export const dynamic = "force-dynamic";

const PERIOD_LABELS: Record<HistoryPeriod, string> = {
  today: "Today", week: "This week", month: "This month", all: "Last 31 days",
};
const CATEGORIES = [
  ["all", "All changes"], ["members", "Member details"],
  ["renewals", "Membership renewals"], ["equipment", "Equipment expenses"], ["other", "Other changes"],
] as const;

function categoryFilter(category: string) {
  if (category === "members") return and(like(activityLogs.event, "member.%"), not(eq(activityLogs.event, "member.renewed")));
  if (category === "renewals") return eq(activityLogs.event, "member.renewed");
  if (category === "equipment") return like(activityLogs.event, "equipment.%");
  if (category === "other") return and(not(like(activityLogs.event, "member.%")), not(like(activityLogs.event, "equipment.%")));
  return undefined;
}

export default async function HistoryPage({ searchParams }: {
  searchParams: Promise<{ period?: string; category?: string; actor?: string; page?: string }>;
}) {
  await requireOwner();
  if (!isHistoryEnabled()) redirect("/admin");
  const scope = await getBranchScope();
  const params = await searchParams;
  const period: HistoryPeriod = HISTORY_PERIODS.includes(params.period as HistoryPeriod) ? params.period as HistoryPeriod : "today";
  const category = CATEGORIES.some(([key]) => key === params.category) ? params.category! : "all";
  const actor = typeof params.actor === "string" ? params.actor.slice(0, 200) : "";
  const requestedPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const { start, end } = getHistoryRange(period);

  // A backstop for local development and hosts without Netlify scheduling.
  // Surface failures instead of pretending retention succeeded.
  await pool.query(DELETE_EXPIRED_ACTIVITY_SQL);

  const baseFilter = and(
    scope.type === "single" ? eq(activityLogs.branchId, scope.branchId)
      : or(inArray(activityLogs.branchId, scope.branchIds), isNull(activityLogs.branchId)),
    gte(activityLogs.createdAt, start), lte(activityLogs.createdAt, end),
  );
  const filter = and(baseFilter, categoryFilter(category), actor ? eq(activityLogs.actorName, actor) : undefined);
  const [rows, totals, actors] = await Promise.all([
    db.select({
      id: activityLogs.id, event: activityLogs.event, details: activityLogs.details,
      changes: activityLogs.changes, actorName: activityLogs.actorName, actorRole: activityLogs.actorRole,
      createdAt: activityLogs.createdAt, branchName: branches.name,
    }).from(activityLogs).leftJoin(branches, eq(activityLogs.branchId, branches.id))
      .where(filter).orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(HISTORY_PAGE_SIZE).offset((page - 1) * HISTORY_PAGE_SIZE),
    db.select({ total: count() }).from(activityLogs).where(filter),
    db.selectDistinct({ name: activityLogs.actorName }).from(activityLogs).where(baseFilter).orderBy(activityLogs.actorName),
  ]);
  const total = Number(totals[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  function href(next: { period?: HistoryPeriod; page?: number } = {}) {
    const query = new URLSearchParams({ period: next.period ?? period });
    if (category !== "all") query.set("category", category);
    if (actor) query.set("actor", actor);
    if ((next.page ?? 1) > 1) query.set("page", String(next.page));
    return `/admin/history?${query}`;
  }
  if (page > pages) redirect(href({ page: pages }));
  const dateFormat = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
  });
  const timeFormat = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit",
  });

  return <>
    <div className="adm-head">
      <h1 className="adm-h1">History</h1>
      <p className="adm-sub"><strong>{scope.type === "single" ? scope.branchName : "All Branches"}</strong> · recent changes</p>
    </div>
    <div className="adm-pagebody">
      <div className="adm-chips adm-history-periods" aria-label="History period">
        {HISTORY_PERIODS.map((key) => <Link key={key} href={href({ period: key })}
          className={`adm-chip${period === key ? " active" : ""}`} aria-current={period === key ? "page" : undefined}>
          {PERIOD_LABELS[key]}
        </Link>)}
      </div>
      <p className="adm-hint" style={{ marginTop: 10 }}>
        {dateFormat.format(start)} – {dateFormat.format(end)} · times in IST
      </p>
      <form className="adm-history-filters" action="/admin/history" method="get">
        <input type="hidden" name="period" value={period} />
        <div className="adm-field">
          <label className="adm-label" htmlFor="history-category">Changes</label>
          <select id="history-category" name="category" defaultValue={category} className="adm-select">
            {CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="history-actor">Changed by</label>
          <select id="history-actor" name="actor" defaultValue={actor} className="adm-select">
            <option value="">Everyone</option>
            {actor && !actors.some((a) => a.name === actor) && <option value={actor}>{actor}</option>}
            {actors.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </div>
        <button type="submit" className="adm-btn">Apply filters</button>
      </form>
      <div className="adm-toolbar">
        <span className="adm-hint">{total} {total === 1 ? "change" : "changes"}</span>
        <RefreshHistory />
      </div>
      {rows.length === 0 ? <div className="adm-empty">
        <div className="adm-empty-icon"><History size={22} /></div>
        <p className="adm-empty-title">No changes found</p>
        <p className="adm-empty-text">Try another period or select Everyone. New changes appear here as they are saved.</p>
      </div> : <section className="adm-card adm-history-list" aria-label="Recent changes">
        {rows.map((entry) => {
          const isRenewal = entry.event === "member.renewed";
          const Icon = entry.event.startsWith("equipment.") ? Wrench : isRenewal ? RefreshCw : entry.event.startsWith("member.") ? Users : History;
          const tone = entry.event.endsWith("deleted") || entry.event.endsWith("voided") ? "tone-red" : isRenewal ? "tone-green" : "tone-blue";
          return <article key={entry.id} className="adm-history-entry">
            <div className="adm-history-top">
              <span className={`adm-feed-icon ${tone}`}><Icon size={16} /></span>
              <div className="adm-history-content">
                <h2 className="adm-feed-title">{ACTIVITY_LABELS[entry.event] ?? "Dashboard updated"}</h2>
                <p className="adm-history-description">{entry.details}</p>
                <p className="adm-history-actor"><UserRound size={13} />
                  <strong>{entry.actorName}</strong> · {entry.actorRole === "owner" ? "Owner" : entry.actorRole === "staff" ? "Staff" : "Automatic"}
                  {scope.type === "all" && ` · ${entry.branchName ?? "Shared settings"}`}
                </p>
              </div>
              <time className="adm-history-time" dateTime={entry.createdAt.toISOString()}>
                <span>{dateFormat.format(entry.createdAt)}</span><span>{timeFormat.format(entry.createdAt)}</span>
              </time>
            </div>
            {entry.changes.length > 0 && <details className="adm-history-changes">
              <summary>View {entry.changes.length} changed {entry.changes.length === 1 ? "field" : "fields"}</summary>
              <dl>{entry.changes.map((change) => <div key={change.field}>
                <dt>{change.label}</dt>
                <dd><span className="adm-history-before">{change.before}</span><span aria-label="changed to"> → </span><strong>{change.after}</strong></dd>
              </div>)}</dl>
            </details>}
          </article>;
        })}
      </section>}
      {pages > 1 && <nav className="adm-toolbar" aria-label="History pages">
        {page > 1 && <Link href={href({ page: page - 1 })} className="adm-btn"><ChevronLeft size={15} /> Newer</Link>}
        <span className="adm-hint">Page {page} of {pages}</span>
        {page < pages && <Link href={href({ page: page + 1 })} className="adm-btn">Older <ChevronRight size={15} /></Link>}
      </nav>}
      <p className="adm-hint adm-history-retention">History entries are automatically deleted after 31 days. Member, payment and expense records stay on file.</p>
    </div>
  </>;
}
