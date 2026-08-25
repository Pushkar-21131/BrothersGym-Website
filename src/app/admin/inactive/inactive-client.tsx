"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  markMemberLeftAction,
  unmarkMemberLeftAction,
} from "@/app/actions/members";
import {
  Search,
  UserX,
  UserCheck,
  MessageCircle,
  AlertTriangle,
  Trophy,
  Phone,
} from "lucide-react";
import { Sheet } from "../sheet";

type Member = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  gymId: number;
  name: string;
  contactNumber: string;
  email: string | null;
  feeAmount: number;
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
};

const REASON_LABELS: Record<string, string> = {
  shifted: "Shifted / Moved",
  not_interested: "Not Interested",
  health: "Health Issue",
  financial: "Financial",
  other: "Other",
};

export default function InactiveMembersClient({
  initialMembers,
  showBranchColumn,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"expired" | "left" | "won_back" | "all">(
    "expired"
  );
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [markLeftMember, setMarkLeftMember] = useState<Member | null>(null);
  const router = useRouter();

  // Read the clock once on mount (lazy initial state) so every row and stat uses
  // the same reference point and render stays pure.
  const [now] = useState(() => Date.now());

  function daysExpired(expiry: string): number {
    return Math.floor((now - new Date(expiry).getTime()) / (1000 * 60 * 60 * 24));
  }

  const stats = useMemo(() => {
    const expired = initialMembers.filter((m) => !m.leftGym).length;
    const left = initialMembers.filter((m) => m.leftGym).length;
    const wonBack = initialMembers.filter((m) => m.wonBackAt).length;
    const autoSuggest = initialMembers.filter(
      (m) => !m.leftGym && daysExpired(m.membershipExpiry) > 60
    ).length;
    return { expired, left, wonBack, autoSuggest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMembers, now]);

  const filtered = useMemo(() => {
    let list = initialMembers;

    if (filter === "expired") list = list.filter((m) => !m.leftGym);
    else if (filter === "left") list = list.filter((m) => m.leftGym);
    else if (filter === "won_back") list = list.filter((m) => m.wonBackAt);

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.gymId.toString().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.contactNumber.includes(q) ||
          (m.branchName && m.branchName.toLowerCase().includes(q))
      );
    }
    return list;
  }, [initialMembers, search, filter]);

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

  function whatsappLink(m: Member) {
    const phone = m.contactNumber.replace(/\D/g, "").slice(-10);
    const days = daysExpired(m.membershipExpiry);
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
        <QStat tone="gold" value={stats.autoSuggest} label="Over 60d" />
      </div>

      <div className="adm-search">
        <Search size={16} />
        <input
          type="search"
          inputMode="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
            onClick={() => setFilter(f.key)}
            className={`adm-chip${filter === f.key ? " active" : ""}`}
          >
            {f.label} {f.count > 0 && `· ${f.count}`}
          </button>
        ))}
      </div>

      {/* Long-expired members are the ones still eating the reminder quota, so
          the nudge to clean them up sits above the list, not inside it. */}
      {stats.autoSuggest > 0 && filter === "expired" && (
        <section className="adm-card adm-note" style={{ marginBottom: 12 }}>
          <AlertTriangle size={17} style={{ color: "var(--gold)", flex: "0 0 auto" }} />
          <div>
            <p className="adm-note-title">
              {stats.autoSuggest} haven&apos;t renewed in over 60 days
            </p>
            <p className="adm-note-text">
              Mark them as left to stop sending reminders. Look for the ⚠ tag.
            </p>
          </div>
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
          const days = daysExpired(m.membershipExpiry);
          const months = Math.floor(days / 30);
          const autoSuggest = !m.leftGym && days > 60;

          return (
            <article
              key={m.id}
              className="adm-rec"
              style={m.leftGym ? { opacity: 0.68 } : undefined}
            >
              <div className="adm-rec-top">
                <div className="adm-rec-ava">{m.name.charAt(0)}</div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-rec-id">M.No {m.gymId}</div>
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
                        title="Expired more than 60 days ago — consider marking as left"
                      >
                        ⚠ Suggest left
                      </span>
                    )}
                    {showBranchColumn && m.branchCode && (
                      <span className="adm-tag muted">{m.branchCode}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="adm-rec-grid">
                <div>
                  <div className="adm-rec-k">Phone</div>
                  <a href={`tel:${m.contactNumber}`} className="adm-rec-v adm-link">
                    <Phone size={11} /> {m.contactNumber}
                  </a>
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
                    <a
                      href={whatsappLink(m)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="adm-act green"
                    >
                      <MessageCircle size={15} />
                      <span className="adm-act-label">Win Back</span>
                    </a>
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

function MarkLeftModal({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<
    "shifted" | "not_interested" | "health" | "financial" | "other"
  >("not_interested");
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
        {member.gymId}) as left. They will no longer receive renewal reminders.
      </p>

      <div className="adm-field">
        <label className="adm-label" htmlFor="ml-reason">
          Reason *
        </label>
        <select
          id="ml-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as typeof reason)}
          className="adm-select"
        >
          <option value="not_interested">Not Interested</option>
          <option value="shifted">Shifted / Moved</option>
          <option value="health">Health Issue</option>
          <option value="financial">Financial Reasons</option>
          <option value="other">Other</option>
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
