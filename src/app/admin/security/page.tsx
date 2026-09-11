import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, gte, ilike, lt, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getVerifiedRole } from "@/lib/auth-check";
import { isSuperAdmin } from "@/lib/branch";

import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  MapPin,
  Monitor,
  Smartphone,
  Globe,
  Clock,
  Search,
} from "lucide-react";

export const dynamic = "force-dynamic";

/** How far back the page looks by default. Anything older rolls off the screen. */
const RETENTION_DAYS = 30;
/** Hard cap so a busy window (or a broad search) can't blow up the page. */
const MAX_ROWS = 100;

type LoginAttempt = typeof loginAttempts.$inferSelect;

/** A query string key can arrive repeated (?q=a&q=b); take the first value. */
function firstValue(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Turn a YYYY-MM-DD value from a date input into an instant, read in IST (the
 * branches' timezone) rather than UTC. "end" pins it to the last millisecond of
 * that day so picking the same date for From and To covers that whole day.
 */
function parseISTDate(value: string, edge: "start" | "end"): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = edge === "start" ? "00:00:00.000" : "23:59:59.999";
  const d = new Date(`${value}T${time}+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ============ HELPERS (unchanged) ============
function parseUserAgent(ua: string): {
  browser: string;
  os: string;
  device: string;
  icon: "phone" | "computer";
} {
  if (!ua || ua === "unknown") {
    return { browser: "Unknown", os: "Unknown", device: "Unknown", icon: "computer" };
  }

  let os = "Unknown";
  if (ua.includes("Windows NT 10.0")) os = "Windows 10/11";
  else if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
  else if (ua.includes("Android")) {
    const m = ua.match(/Android (\d+)/);
    os = m ? `Android ${m[1]}` : "Android";
  } else if (ua.includes("iPhone") || ua.includes("iOS")) {
    const m = ua.match(/OS (\d+)_/);
    os = m ? `iOS ${m[1]}` : "iOS";
  } else if (ua.includes("iPad")) os = "iPadOS";

  let browser = "Unknown";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";

  let device = "Desktop";
  let icon: "phone" | "computer" = "computer";
  if (ua.includes("Mobile") || ua.includes("Android") || ua.includes("iPhone")) {
    device = "Mobile";
    icon = "phone";
  } else if (ua.includes("iPad") || ua.includes("Tablet")) {
    device = "Tablet";
    icon = "phone";
  }

  return { browser, os, device, icon };
}

function formatIP(ip: string | null): {
  display: string;
  isLocal: boolean;
  location: string;
} {
  if (!ip || ip === "unknown") {
    return { display: "Unknown", isLocal: false, location: "Unknown" };
  }
  if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return { display: "Localhost", isLocal: true, location: "Your device" };
  }
  if (ip.includes(":")) {
    return { display: ip.slice(0, 20) + "...", isLocal: false, location: "IPv6 address" };
  }
  return { display: ip, isLocal: false, location: "External IP" };
}

function timeAgo(date: Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en-IN");
}

// ============ ONE LOG ENTRY ============
/** Shared by the 30-day list and the full-history search results. */
function AttemptCard({ a }: { a: LoginAttempt }) {
  const ua = parseUserAgent(a.userAgent || "");
  const ipInfo = formatIP(a.ipAddress);
  const when = a.createdAt ? new Date(a.createdAt) : null;

  return (
    <article className="adm-rec">
      <div className="adm-rec-top">
        <div className={`adm-rec-ava ${a.success ? "ok" : "bad"}`}>
          {a.success ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="adm-rec-name">{a.email}</div>
          <div className="adm-rec-tags">
            <span className={`adm-tag ${a.success ? "ok" : "off"}`}>
              {a.success ? "Success" : "Failed"}
            </span>
            {/* The reason is only ever set on a failure, and it is the whole
                story of the row — a wrong password reads very differently
                from an unknown email. */}
            {!a.success && a.reason && (
              <span className="adm-tag muted">{a.reason.replace(/-/g, " ")}</span>
            )}
          </div>
        </div>

        <div className="adm-rec-when">
          <b>{when ? timeAgo(when) : "—"}</b>
          <span>
            {when
              ? when.toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </span>
        </div>
      </div>

      <div className="adm-rec-grid">
        <div>
          <div className="adm-rec-k">Device</div>
          <div className="adm-rec-v">
            {ua.icon === "phone" ? <Smartphone size={11} /> : <Monitor size={11} />}{" "}
            {ua.browser} · {ua.os}
          </div>
        </div>

        <div>
          <div className="adm-rec-k">Where from</div>
          <div
            className="adm-rec-v"
            style={ipInfo.isLocal ? { color: "var(--blue2)" } : undefined}
          >
            {ipInfo.isLocal ? <MapPin size={11} /> : <Globe size={11} />}{" "}
            {ipInfo.display}
          </div>
        </div>
      </div>
    </article>
  );
}

// ============ PAGE ============
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 🔒 PERMISSION CHECK — main owner account only.
  //
  // The login log is deliberately NOT reachable by a branch-scoped owner or by
  // staff. `login_attempts` has no branch_id and cannot get one: an attempt is
  // recorded before anyone is authenticated, so at write time there is no branch
  // to attribute it to. That makes the table impossible to scope, and every row
  // carries an email, an IP and a city — so a branch owner opening this page
  // would be reading the OTHER owner's login activity.
  //
  // Undo: this follows BRANCH_SCOPED_OWNERS like everything else. With scoped
  // owners off, isSuperAdmin() is true for every owner and this page returns to
  // being owner-wide.
  if (!(await isSuperAdmin())) {
    const role = await getVerifiedRole();
    if (!role) redirect("/login");
    redirect("/admin/members");
  }

  // ---- Archive search (searches ALL history, including past 30 days) ----
  const params = await searchParams;
  const q = firstValue(params.q).trim();
  const fromRaw = firstValue(params.from);
  const toRaw = firstValue(params.to);
  const resultRaw = firstValue(params.result);
  const result: "success" | "failed" | "" =
    resultRaw === "success" || resultRaw === "failed" ? resultRaw : "";

  const from = parseISTDate(fromRaw, "start");
  const to = parseISTDate(toRaw, "end");

  const searchActive = Boolean(q || from || to || result);
  // Submitting the form with every field blank still navigates. Track that
  // separately so the panel stays open instead of silently snapping shut.
  const searchSubmitted = ["q", "from", "to", "result"].some((k) => k in params);

  // ---- 30-day rolling window ----
  // The log grows forever, so the page only ever renders the last 30 days.
  // Older rows stay in the database (they are an audit trail) — they just drop
  // off the screen, and the count of what rolled off is shown at the bottom.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const windowStart = new Date(now - RETENTION_DAYS * 86400000);

  const [attempts, archived] = await Promise.all([
    db
      .select()
      .from(loginAttempts)
      .where(gte(loginAttempts.createdAt, windowStart))
      .orderBy(desc(loginAttempts.createdAt))
      .limit(MAX_ROWS),
    db
      .select({ count: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(lt(loginAttempts.createdAt, windowStart)),
  ]);

  const archivedCount = Number(archived[0]?.count ?? 0);

  // Run the archive query only when the owner actually asked for it, so the
  // normal page load stays at two queries.
  let searchResults: LoginAttempt[] = [];
  let searchTotal = 0;

  if (searchActive) {
    const filters: SQL[] = [];

    if (q) {
      const like = `%${q}%`;
      const match = or(
        ilike(loginAttempts.email, like),
        ilike(loginAttempts.ipAddress, like),
        ilike(loginAttempts.reason, like)
      );
      if (match) filters.push(match);
    }
    if (from) filters.push(gte(loginAttempts.createdAt, from));
    if (to) filters.push(lte(loginAttempts.createdAt, to));
    if (result) {
      filters.push(
        result === "success"
          ? sql`${loginAttempts.success} = true`
          : sql`${loginAttempts.success} = false`
      );
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(loginAttempts)
        .where(where)
        .orderBy(desc(loginAttempts.createdAt))
        .limit(MAX_ROWS),
      db
        .select({ count: sql<number>`count(*)` })
        .from(loginAttempts)
        .where(where),
    ]);

    searchResults = rows;
    searchTotal = Number(total[0]?.count ?? 0);
  }

  const successCount = attempts.filter((a) => a.success).length;
  const failedCount = attempts.filter((a) => !a.success).length;
  const uniqueIPs = new Set(attempts.map((a) => a.ipAddress).filter(Boolean)).size;

  const cutoff24h = now - 86400000;
  const last24h = attempts.filter((a) => {
    if (!a.createdAt) return false;
    return new Date(a.createdAt).getTime() >= cutoff24h;
  }).length;

  const windowLabel = windowStart.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Security</h1>
        <p className="adm-sub">
          Logins since <strong>{windowLabel}</strong> · last {RETENTION_DAYS} days
        </p>
      </div>

      {/* The four numbers first: on a phone this is usually the whole visit —
          glance at failed vs successful, then leave. */}
      <div className="adm-qstats">
        <div className="adm-qstat">
          <div className="adm-qstat-icon tone-green">
            <ShieldCheck size={15} />
          </div>
          <div className="adm-qstat-v" style={{ color: "var(--green2)" }}>
            {successCount}
          </div>
          <div className="adm-qstat-k">Successful</div>
        </div>

        <div className="adm-qstat">
          <div className="adm-qstat-icon tone-red">
            <ShieldAlert size={15} />
          </div>
          <div className="adm-qstat-v" style={{ color: "var(--red2)" }}>
            {failedCount}
          </div>
          <div className="adm-qstat-k">Failed</div>
        </div>

        <div className="adm-qstat">
          <div className="adm-qstat-icon tone-gold">
            <Globe size={15} />
          </div>
          <div className="adm-qstat-v">{uniqueIPs}</div>
          <div className="adm-qstat-k">Unique IPs</div>
        </div>

        <div className="adm-qstat">
          <div className="adm-qstat-icon tone-blue">
            <Clock size={15} />
          </div>
          <div className="adm-qstat-v">{last24h}</div>
          <div className="adm-qstat-k">Last 24h</div>
        </div>
      </div>

      {failedCount > 5 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <ShieldAlert size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div>
            <p className="adm-note-title">Several failed logins</p>
            <p className="adm-note-text">
              {failedCount} failed attempts in the last {RETENTION_DAYS} days. If
              none of them were you, change your password.
            </p>
          </div>
        </section>
      )}

      {/* ---- Full history search ---- */}
      {/* A plain GET form: the browser puts the fields in the URL, this server
          component reads them back. No client JS, and every search is a
          shareable/bookmarkable link. */}
      <details
        open={searchActive || searchSubmitted}
        className="adm-fold"
        style={{ marginTop: 12 }}
      >
        <summary>
          <Search size={15} style={{ color: "var(--gold)" }} />
          Search full history
          <span className="adm-fold-hint">
            {archivedCount > 0
              ? `${archivedCount} older ${archivedCount === 1 ? "entry" : "entries"}`
              : "tap to open"}
          </span>
        </summary>

        <div className="adm-fold-body">
          <p className="adm-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Searches every log ever recorded, including entries older than{" "}
            {RETENTION_DAYS} days.
          </p>

          <form method="get">
            <div className="adm-field">
              <label className="adm-label" htmlFor="q">
                Email, IP or reason
              </label>
              <input
                id="q"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="e.g. staff@brothersgym.in"
                className="adm-input"
              />
            </div>

            <div className="adm-form-grid">
              <div className="adm-field">
                <label className="adm-label" htmlFor="from">
                  From date
                </label>
                <input
                  id="from"
                  type="date"
                  name="from"
                  defaultValue={fromRaw}
                  className="adm-input"
                />
              </div>

              <div className="adm-field">
                <label className="adm-label" htmlFor="to">
                  To date
                </label>
                <input
                  id="to"
                  type="date"
                  name="to"
                  defaultValue={toRaw}
                  className="adm-input"
                />
              </div>

              <div className="adm-field span2">
                <label className="adm-label" htmlFor="result">
                  Result
                </label>
                <select
                  id="result"
                  name="result"
                  defaultValue={result}
                  className="adm-select"
                >
                  <option value="">All</option>
                  <option value="success">Successful only</option>
                  <option value="failed">Failed only</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="submit" className="adm-btn primary" style={{ flex: 1 }}>
                <Search size={15} />
                Search
              </button>
              {(searchActive || searchSubmitted) && (
                <Link href="/admin/security" className="adm-link">
                  Clear
                </Link>
              )}
            </div>
          </form>

          {searchActive && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid var(--border)",
              }}
            >
              {searchResults.length === 0 ? (
                <p
                  className="adm-hint"
                  style={{ textAlign: "center", padding: "16px 0", margin: 0 }}
                >
                  No log entries match that search.
                </p>
              ) : (
                <>
                  <p className="adm-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                    {searchTotal} {searchTotal === 1 ? "match" : "matches"}
                    {searchTotal > MAX_ROWS &&
                      ` — showing the ${MAX_ROWS} most recent. Narrow the dates to see the rest.`}
                  </p>
                  <div className="adm-list">
                    {searchResults.map((a) => (
                      <AttemptCard key={a.id} a={a} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </details>

      <h2 className="adm-h2">
        <Clock size={14} /> Recent activity · {attempts.length}
      </h2>

      {attempts.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <ShieldCheck size={22} />
          </div>
          <p className="adm-empty-title">Nothing to report</p>
          <p className="adm-empty-text">
            No login attempts in the last {RETENTION_DAYS} days.
          </p>
        </div>
      ) : (
        <div className="adm-list">
          {attempts.map((a) => (
            <AttemptCard key={a.id} a={a} />
          ))}
        </div>
      )}

      {(attempts.length >= MAX_ROWS || archivedCount > 0) && (
        <p className="adm-footnote">
          {attempts.length >= MAX_ROWS &&
            `Showing the latest ${MAX_ROWS} attempts from this window. `}
          {archivedCount > 0 && (
            <>
              {archivedCount} older{" "}
              {archivedCount === 1 ? "entry is" : "entries are"} hidden — use{" "}
              <b>Search full history</b> above to find them.
            </>
          )}
        </p>
      )}

      <h2 className="adm-h2">
        <Shield size={14} /> About login tracking
      </h2>
      <section className="adm-card">
        <ul className="adm-bullets">
          <li>
            <b style={{ color: "var(--blue2)" }}>Localhost</b> means the login came
            from this computer, during development.
          </li>
          <li>Real users on the live site show their actual IP address.</li>
          <li>
            After <b>5 failed attempts</b> that IP is blocked for 30 minutes.
          </li>
          <li>
            You get an <b>email alert</b> straight away if someone tries to log in
            with the owner email.
          </li>
          <li>
            The list above is a rolling <b>{RETENTION_DAYS}-day</b> window so the
            page stays short. Nothing is ever deleted — older entries are still in
            the database and can be pulled up any time from{" "}
            <b>Search full history</b>.
          </li>
        </ul>
      </section>
    </>
  );
}




