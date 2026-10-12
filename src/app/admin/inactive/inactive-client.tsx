"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  markMemberLeftAction,
  unmarkMemberLeftAction,
  bulkMarkMembersLeftAction,
  bulkRestoreMembersAction,
} from "@/app/actions/members";
import {
  Search,
  UserX,
  UserCheck,
  MessageCircle,
  AlertTriangle,
  Trophy,
  Phone,
  Undo2,
  ListChecks,
} from "lucide-react";
import { Sheet } from "../sheet";
import { hasDialablePhone } from "@/lib/whatsapp";
import { formatGymId } from "@/lib/utils";
import { memberMatches } from "@/lib/member-search";

/**
 * One row as `admin/inactive/page.tsx` selects it — exported so that page can
 * annotate its query instead of casting to `any`.
 *
 * `email` and `feeAmount` used to be here and are deliberately gone. Nothing in
 * this file ever rendered either one, but the page selected both and shipped
 * them in the RSC payload for every expired and left member — including to a
 * staff account with fees or email hidden, since this page never consulted
 * `hiddenFields` at all. Not selecting a column is a stronger guarantee than
 * blanking it: there is no configuration to get wrong and nothing to leak.
 */
export type Member = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  gymId: number;
  name: string;
  /** "full" is Cardio — the register's C, for the M.No as it is written there. */
  planType: string | null;
  contactNumber: string;
  joiningDate: string;
  membershipExpiry: string;
  leftGym: boolean;
  leftGymDate: string | null;
  leftGymReason: string | null;
  leftGymNote: string | null;
  wonBackAt: Date | null;
};

type Props = {
  initialMembers: Member[];
  showBranchColumn: boolean;
  /** Server clock in ms — passed in so the SSR pass and hydration cannot disagree. */
  now: number;
};

const REASON_LABELS: Record<string, string> = {
  shifted: "Shifted / Moved",
  not_interested: "Not Interested",
  health: "Health Issue",
  financial: "Financial",
  other: "Other",
};

type Reason = "shifted" | "not_interested" | "health" | "financial" | "other";

/** Most common first, which is why "Not Interested" leads. */
const REASON_ORDER: Reason[] = [
  "not_interested",
  "shifted",
  "health",
  "financial",
  "other",
];

const AGE_STEPS = [
  { key: "7", days: 7, label: "7+ days ago" },
  { key: "30", days: 30, label: "30+ days ago" },
  { key: "60", days: 60, label: "60+ days ago" },
  { key: "90", days: 90, label: "90+ days ago" },
  { key: "180", days: 180, label: "6+ months ago" },
  { key: "365", days: 365, label: "1+ year ago" },
];

/** The age the ⚠ tag has always used. The tag and the filter must not disagree. */
const DEFAULT_SUGGEST_DAYS = 60;

/**
 * Whole days between a stored "YYYY-MM-DD" and now.
 *
 * Module scope, taking `now` as an argument, so it can be called from a `useMemo`
 * without becoming a dependency. The date string parses as UTC midnight while
 * `now` is local, so in IST this floors to 0 for a date of today and 1 for
 * yesterday — the same arithmetic the page has always used.
 */
function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}

/**
 * The date the age filter measures from: the day a left member left, and
 * otherwise the day their membership ran out. Measuring left rows from
 * `membershipExpiry` instead would bury the batch you just marked under people
 * who expired years ago.
 */
function baseDate(m: Member): string {
  return m.leftGym ? m.leftGymDate ?? m.membershipExpiry : m.membershipExpiry;
}

export default function InactiveMembersClient({
  initialMembers,
  showBranchColumn,
  now,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"expired" | "left" | "won_back" | "all">(
    "expired"
  );
  const [age, setAge] = useState("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkMode, setBulkMode] = useState<"mark" | "restore" | null>(null);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [markLeftMember, setMarkLeftMember] = useState<Member | null>(null);
  // The ids a bulk mark just changed, so the one tap that undoes it is exact
  // rather than "filter by today's date and hope".
  const [undoBatch, setUndoBatch] = useState<number[] | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const router = useRouter();

  const suggestDays =
    AGE_STEPS.find((s) => s.key === age)?.days ?? DEFAULT_SUGGEST_DAYS;

  const stats = useMemo(() => {
    const expired = initialMembers.filter((m) => !m.leftGym).length;
    const left = initialMembers.filter((m) => m.leftGym).length;
    const wonBack = initialMembers.filter((m) => m.wonBackAt).length;
    const autoSuggest = initialMembers.filter(
      (m) => !m.leftGym && daysSince(m.membershipExpiry, now) > suggestDays
    ).length;
    return { expired, left, wonBack, autoSuggest };
  }, [initialMembers, now, suggestDays]);

  const filtered = useMemo(() => {
    let list = initialMembers;

    if (filter === "expired") list = list.filter((m) => !m.leftGym);
    else if (filter === "left") list = list.filter((m) => m.leftGym);
    else if (filter === "won_back") list = list.filter((m) => m.wonBackAt);

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      // The same reader the members list uses, so "1" means M.No 1 here too —
      // matching every field as a substring used to return every row on file,
      // since a 1 sits inside almost every phone number. Nothing is hidden on
      // this page: it selects no hideable column at all.
      list = list.filter((m) => memberMatches(m, q, "all", () => false));
    }

    // The grace period matters here: a membership that ran out last week can
    // still be renewed, so "7+ days" is the earliest group worth acting on.
    if (age === "custom") {
      // ISO strings compare correctly as strings, so no Date round trip.
      if (from) list = list.filter((m) => baseDate(m) >= from);
      if (to) list = list.filter((m) => baseDate(m) <= to);
    } else if (age !== "any") {
      const step = AGE_STEPS.find((s) => s.key === age);
      if (step) list = list.filter((m) => daysSince(baseDate(m), now) >= step.days);
    }

    return list;
  }, [initialMembers, search, filter, age, from, to, now]);

  // Derived from `filtered`, never from `selected` alone. That is what makes the
  // counter un-abusable: an id that is no longer on screen cannot be in this
  // list, so it cannot be sent, however the ticks got there.
  const picked = useMemo(
    () => filtered.filter((m) => selected.has(m.id)),
    [filtered, selected]
  );
  const toMark = picked.filter((m) => !m.leftGym);
  const toRestore = picked.filter((m) => m.leftGym);
  const allShownPicked = filtered.length > 0 && picked.length === filtered.length;

  // Ticks are cleared by anything that changes what is on screen, so what is
  // counted is always what is visible. The `picked` derivation above is the
  // backstop; this is what keeps the number from being merely correct.
  function resetPick() {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allShownPicked ? new Set() : new Set(filtered.map((m) => m.id)));
  }

  async function handleUnmark(m: Member) {
    if (!confirm(`Restore "${m.name}" to active members list?`)) return;
    setMarkingId(m.id);
    const r = await unmarkMemberLeftAction(m.id);
    setMarkingId(null);
    if (r.error) toast.error(r.error);
    else {
      toast.success(`${m.name} restored`);
      router.refresh();
    }
  }

  /** Runs whichever bulk action the sheet was opened for. Returns true if the
   *  sheet should close. */
  async function runBulk(mode: "mark" | "restore", reason?: Reason, note?: string) {
    const targets = mode === "mark" ? toMark : toRestore;
    const ids = targets.map((m) => m.id);
    if (ids.length === 0) {
      toast.error("Nothing to do — those members are already in that state");
      return false;
    }

    const r =
      mode === "mark"
        ? await bulkMarkMembersLeftAction(ids, reason as Reason, note)
        : await bulkRestoreMembersAction(ids);

    if (!r.success) {
      toast.error(r.error);
      return false;
    }

    // `skipped` is what the server's own filter refused — already in the target
    // state, or outside this account's branches. Saying so is more honest than
    // reporting the number that was asked for.
    const skipped = r.skipped > 0 ? ` · ${r.skipped} skipped` : "";
    toast.success(
      mode === "mark"
        ? `${r.changed} marked as left${skipped}`
        : `${r.changed} restored to active${skipped}`
    );

    setSelected(new Set());
    // Undo is offered for the mark only, and holding the ids we sent is exact.
    // If any were skipped, restore's own `leftGym = true` guard ignores them.
    setUndoBatch(mode === "mark" ? ids : null);
    router.refresh();
    return true;
  }

  async function undoLast() {
    if (!undoBatch) return;
    const ids = undoBatch;
    setUndoBatch(null);
    setUndoBusy(true);
    const r = await bulkRestoreMembersAction(ids);
    setUndoBusy(false);
    if (!r.success) toast.error(r.error);
    else {
      toast.success(`${r.changed} restored`);
      router.refresh();
    }
  }

  function whatsappLink(m: Member) {
    const phone = m.contactNumber.replace(/\D/g, "").slice(-10);
    const days = daysSince(m.membershipExpiry, now);
    const msg = encodeURIComponent(
      `Hi ${m.name}, we noticed your Brothers Gym membership expired ${days} days ago on ${m.membershipExpiry}. ` +
        `We'd love to welcome you back! Renew now to continue your fitness journey. 💪`
    );
    return `https://wa.me/91${phone}?text=${msg}`;
  }

  const FILTERS = [
    { key: "expired" as const, label: "Expired", count: stats.expired },
    { key: "left" as const, label: "Left", count: stats.left },
    { key: "won_back" as const, label: "Won Back", count: stats.wonBack },
    { key: "all" as const, label: "All", count: initialMembers.length },
  ];

  return (
    <div className="adm-pagebody">
      <div className="adm-qstats" style={{ marginTop: 0, marginBottom: 14 }}>
        <QStat tone="red" value={stats.expired} label="Expired" />
        <QStat tone="orange" value={stats.left} label="Left Gym" />
        <QStat tone="green" value={stats.wonBack} label="Won Back" />
        <QStat tone="gold" value={stats.autoSuggest} label={`Over ${suggestDays}d`} />
      </div>

      <div className="adm-search">
        <Search size={16} />
        <input
          type="search"
          inputMode="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPick();
          }}
          placeholder="Search M.No, name, phone…"
          aria-label="Search inactive members"
        />
      </div>

      <div className="adm-chips" role="tablist" aria-label="Filter inactive members">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              resetPick();
            }}
            className={`adm-chip${filter === f.key ? " active" : ""}`}
          >
            {f.label} {f.count > 0 && `· ${f.count}`}
          </button>
        ))}
      </div>

      {/* The age select and select-all share one row: on a phone a second row of
          chips here would be chrome the list has to scroll past. */}
      <div className="adm-frow">
        <select
          className="adm-agesel"
          value={age}
          onChange={(e) => {
            setAge(e.target.value);
            resetPick();
          }}
          aria-label="Filter by how long ago"
        >
          <option value="any">Any age</option>
          {AGE_STEPS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          <option value="custom">Custom dates…</option>
        </select>

        {filtered.length > 0 && (
          <button
            type="button"
            className="adm-btn sm"
            onClick={toggleAll}
            aria-pressed={allShownPicked}
          >
            <ListChecks size={14} />
            {allShownPicked ? "Clear" : `All ${filtered.length}`}
          </button>
        )}
      </div>

      {age === "custom" && (
        <>
          <div className="adm-dategrid">
            <div>
              <label className="adm-label" htmlFor="flt-from">
                From
              </label>
              <input
                id="flt-from"
                type="date"
                className="adm-input"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPick();
                }}
              />
            </div>
            <div>
              <label className="adm-label" htmlFor="flt-to">
                To
              </label>
              <input
                id="flt-to"
                type="date"
                className="adm-input"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPick();
                }}
              />
            </div>
          </div>
          {/* Which date these compare against depends on the tab, and getting it
              wrong filters the wrong members silently. */}
          <p className="adm-hint" style={{ marginTop: -4, marginBottom: 11 }}>
            {filter === "left"
              ? "Matches the day they were marked left."
              : "Matches the membership expiry date."}
          </p>
        </>
      )}

      {picked.length > 0 && (
        <section className="adm-card adm-bulkbar">
          <p className="adm-bulkbar-n">
            {picked.length} selected
            <span>
              {toMark.length > 0 && `${toMark.length} to mark`}
              {toMark.length > 0 && toRestore.length > 0 && " · "}
              {toRestore.length > 0 && `${toRestore.length} to restore`}
            </span>
          </p>
          <div className="adm-bulkbar-acts">
            <button
              type="button"
              className="adm-btn danger"
              disabled={toMark.length === 0}
              onClick={() => setBulkMode("mark")}
            >
              Mark as Left
            </button>
            <button
              type="button"
              className="adm-btn"
              disabled={toRestore.length === 0}
              onClick={() => setBulkMode("restore")}
            >
              Restore to active
            </button>
          </div>
        </section>
      )}

      {undoBatch && picked.length === 0 && (
        <section className="adm-card adm-note good" style={{ marginBottom: 12 }}>
          <Trophy size={17} style={{ color: "var(--green2)", flex: "0 0 auto" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="adm-note-title">Batch marked as left</p>
            <p className="adm-note-text">
              Renewal reminders to them have stopped. Undo puts all of them back.
            </p>
          </div>
          <button
            type="button"
            className="adm-btn sm"
            onClick={undoLast}
            disabled={undoBusy}
            style={{ flex: "0 0 auto" }}
          >
            <Undo2 size={14} />
            {undoBusy ? "Undoing…" : "Undo"}
          </button>
        </section>
      )}

      {/* Long-expired members are the ones still eating the reminder quota, so
          the nudge to clean them up sits above the list, not inside it. It only
          shows while the age filter is untouched — once it is set, the ⚠ tags
          and the select-all button are already the answer. */}
      {stats.autoSuggest > 0 &&
        filter === "expired" &&
        age === "any" &&
        !search.trim() &&
        picked.length === 0 && (
          <section className="adm-card adm-note" style={{ marginBottom: 12 }}>
            <AlertTriangle
              size={17}
              style={{ color: "var(--gold)", flex: "0 0 auto" }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="adm-note-title">
                {stats.autoSuggest} haven&apos;t renewed in over{" "}
                {DEFAULT_SUGGEST_DAYS} days
              </p>
              <p className="adm-note-text">
                Mark them as left to stop sending reminders.
              </p>
            </div>
            <button
              type="button"
              className="adm-btn sm"
              onClick={() => {
                setAge(String(DEFAULT_SUGGEST_DAYS));
                resetPick();
              }}
              style={{ flex: "0 0 auto" }}
            >
              Show them
            </button>
          </section>
        )}

      {filtered.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <UserX size={22} />
          </div>
          <p className="adm-empty-title">Nothing here</p>
          <p className="adm-empty-text">No members in this category.</p>
        </div>
      ) : (
        <div className="adm-list">
        {filtered.map((m) => {
          const days = daysSince(m.membershipExpiry, now);
          const months = Math.floor(days / 30);
          const autoSuggest = !m.leftGym && days > suggestDays;
          const isPicked = selected.has(m.id);

          return (
            <article
              key={m.id}
              className={`adm-rec${isPicked ? " picked" : ""}`}
              style={m.leftGym && !isPicked ? { opacity: 0.68 } : undefined}
            >
              <div className="adm-rec-top">
                <div className="adm-rec-ava">{m.name.charAt(0)}</div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-rec-id">
                    M.No {formatGymId(m.gymId, m.planType)}
                  </div>
                  <div className="adm-rec-name">{m.name}</div>
                  <div className="adm-rec-tags">
                    {m.leftGym ? (
                      <span className="adm-tag off">Left gym</span>
                    ) : (
                      <span className="adm-tag warn">
                        {months >= 1 ? `${months}mo ago` : `${days}d ago`}
                      </span>
                    )}
                    {m.wonBackAt && (
                      <span className="adm-tag ok">
                        <Trophy size={9} /> Won back
                      </span>
                    )}
                    {autoSuggest && (
                      <span
                        className="adm-tag gold"
                        title={`Expired more than ${suggestDays} days ago — consider marking as left`}
                      >
                        ⚠ Suggest left
                      </span>
                    )}
                    {showBranchColumn && m.branchCode && (
                      <span className="adm-tag muted">{m.branchCode}</span>
                    )}
                  </div>
                </div>

                <label className="adm-tick" title="Select this member">
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggleOne(m.id)}
                    aria-label={`Select ${m.name}`}
                  />
                </label>
              </div>

              <div className="adm-rec-grid">
                <div>
                  <div className="adm-rec-k">Phone</div>
                  {hasDialablePhone(m.contactNumber) ? (
                    <a href={`tel:${m.contactNumber}`} className="adm-rec-v adm-link">
                      <Phone size={11} /> {m.contactNumber}
                    </a>
                  ) : (
                    <div className="adm-rec-v" style={{ color: "var(--text3)" }}>
                      Not on file
                    </div>
                  )}
                </div>
                <div>
                  <div className="adm-rec-k">Expired</div>
                  <div className="adm-rec-v" style={{ color: "var(--red2)" }}>
                    {m.membershipExpiry}
                  </div>
                </div>
                {m.leftGym && m.leftGymDate && (
                  <>
                    <div>
                      <div className="adm-rec-k">Left on</div>
                      <div className="adm-rec-v">{m.leftGymDate}</div>
                    </div>
                    <div>
                      <div className="adm-rec-k">Reason</div>
                      <div className="adm-rec-v">
                        {m.leftGymReason
                          ? REASON_LABELS[m.leftGymReason] || m.leftGymReason
                          : "—"}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {m.leftGymNote && (
                <p className="adm-hint" style={{ fontStyle: "italic", marginTop: 9 }}>
                  Note: {m.leftGymNote}
                </p>
              )}

              <div className="adm-rec-foot">
                {!m.leftGym ? (
                  <>
                    {hasDialablePhone(m.contactNumber) && (
                      <a
                        href={whatsappLink(m)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="adm-act green"
                      >
                        <MessageCircle size={15} />
                        <span className="adm-act-label">Win Back</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setMarkLeftMember(m)}
                      disabled={markingId === m.id}
                      className="adm-act red"
                    >
                      <UserX size={15} />
                      <span className="adm-act-label">Mark Left</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUnmark(m)}
                    disabled={markingId === m.id}
                    className="adm-act gold"
                  >
                    <UserCheck size={15} />
                    <span className="adm-act-label">
                      {markingId === m.id ? "Restoring…" : "Restore to active"}
                    </span>
                  </button>
                )}
              </div>
            </article>
          );
        })}
        </div>
      )}

      {markLeftMember && (
        <MarkLeftModal
          member={markLeftMember}
          onClose={() => setMarkLeftMember(null)}
          onDone={() => {
            setMarkLeftMember(null);
            router.refresh();
          }}
        />
      )}

      {bulkMode && (
        <BulkSheet
          mode={bulkMode}
          targets={bulkMode === "mark" ? toMark : toRestore}
          onClose={() => setBulkMode(null)}
          onConfirm={(reason, note) => runBulk(bulkMode, reason, note)}
        />
      )}
    </div>
  );
}

// ===== Sub-components =====
function QStat({
  tone,
  value,
  label,
}: {
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div className="adm-qstat">
      <div className="adm-qstat-v" style={{ color: `var(--${tone})` }}>
        {value}
      </div>
      <div className="adm-qstat-k">{label}</div>
    </div>
  );
}

/**
 * How many names the confirm sheet lists before switching to a count. Kept low
 * and the list is never scrolled: a scrollable box of names hides the ones below
 * the fold with nothing to say they are there, which is the opposite of what a
 * last look before a 1,400-row write should do.
 */
const SAMPLE_SIZE = 6;

function BulkSheet({
  mode,
  targets,
  onClose,
  onConfirm,
}: {
  mode: "mark" | "restore";
  targets: Member[];
  onClose: () => void;
  onConfirm: (reason?: Reason, note?: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<Reason>("not_interested");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const marking = mode === "mark";
  const sample = targets.slice(0, SAMPLE_SIZE);
  const rest = targets.length - sample.length;

  async function handleSave() {
    setLoading(true);
    const ok = await onConfirm(marking ? reason : undefined, note);
    setLoading(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      onClose={onClose}
      title={marking ? `Mark ${targets.length} as Left` : `Restore ${targets.length}`}
    >
      <p className="adm-hint" style={{ marginBottom: 14 }}>
        {marking ? (
          <>
            Marking <strong style={{ color: "var(--text)" }}>{targets.length}</strong>{" "}
            {targets.length === 1 ? "member" : "members"} as left. Renewal reminders
            to them stop immediately. Whoever joins again is un-marked
            automatically.
          </>
        ) : (
          <>
            Returning{" "}
            <strong style={{ color: "var(--text)" }}>{targets.length}</strong>{" "}
            {targets.length === 1 ? "member" : "members"} to the active list. They
            start receiving renewal reminders again.
          </>
        )}
      </p>

      <div className="adm-card" style={{ marginBottom: 14 }}>
        {sample.map((m) => (
          <div
            key={m.id}
            style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0" }}
          >
            <span
              className="adm-rec-id"
              style={{ flex: "0 0 auto", minWidth: 52 }}
            >
              M.No {formatGymId(m.gymId, m.planType)}
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {m.name}
            </span>
          </div>
        ))}
        {rest > 0 && (
          <p className="adm-hint" style={{ marginTop: 6 }}>
            …and {rest} more
          </p>
        )}
      </div>

      {marking && (
        <>
          <div className="adm-field">
            <label className="adm-label" htmlFor="bulk-reason">
              Reason for all of them *
            </label>
            <select
              id="bulk-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
              className="adm-select"
            >
              {REASON_ORDER.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r]}
                </option>
              ))}
            </select>
            {/* One reason is stored on every row in the batch. Marking a group
                with mixed reasons means running the batch more than once — the
                field is per-member, and a shared value would be a guess. */}
          </div>

          <div className="adm-field">
            <label className="adm-label" htmlFor="bulk-note">
              Note (optional)
            </label>
            <textarea
              id="bulk-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Copied onto every member in this batch"
              className="adm-textarea"
            />
          </div>
        </>
      )}

      <p className="adm-hint" style={{ marginBottom: 14 }}>
        {marking
          ? "Undo is one tap right after this, or filter Left by the date to find them later."
          : "Left-on dates and reasons are cleared. Anyone previously won back keeps that record."}
      </p>

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className={marking ? "adm-btn danger" : "adm-btn primary"}
          style={{ flex: 2 }}
        >
          {loading
            ? "Saving…"
            : marking
              ? `Mark ${targets.length} as Left`
              : `Restore ${targets.length}`}
        </button>
      </div>
    </Sheet>
  );
}

function MarkLeftModal({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<Reason>("not_interested");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);
    const r = await markMemberLeftAction(member.id, reason, note);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success(`${member.name} marked as left`);
      onDone();
    }
  }

  return (
    <Sheet onClose={onClose} title="Mark as Left Gym">
      <p className="adm-hint" style={{ marginBottom: 16 }}>
        Marking <strong style={{ color: "var(--text)" }}>{member.name}</strong> (M.No{" "}
        {formatGymId(member.gymId, member.planType)}) as left. They will no longer
        receive renewal reminders.
      </p>

      <div className="adm-field">
        <label className="adm-label" htmlFor="ml-reason">
          Reason *
        </label>
        <select
          id="ml-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as Reason)}
          className="adm-select"
        >
          {REASON_ORDER.map((r) => (
            <option key={r} value={r}>
              {REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="adm-field">
        <label className="adm-label" htmlFor="ml-note">
          Note (optional)
        </label>
        <textarea
          id="ml-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Any extra details (e.g. 'moved to Bangalore')"
          className="adm-textarea"
        />
      </div>

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="adm-btn danger"
          style={{ flex: 2 }}
        >
          {loading ? "Saving…" : "Confirm"}
        </button>
      </div>
    </Sheet>
  );
}
