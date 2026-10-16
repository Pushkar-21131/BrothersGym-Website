"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addEnquiryAction,
  updateEnquiryAction,
  deleteEnquiryAction,
  markEnquiryStatusAction,
  logEnquiryContactAction,
} from "@/app/actions/enquiries";
import {
  Plus,
  Search,
  Phone,
  MessageCircle,
  Edit,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  RotateCcw,
  Inbox,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { Sheet } from "../sheet";
import EnquiryImportSheet from "./enquiry-import";
import { istDateString, addDaysIso } from "@/lib/utils";
import {
  buildWhatsAppLink,
  generateEnquiryMessage,
  hasDialablePhone,
  type EnquiryTemplateId,
} from "@/lib/whatsapp";

/**
 * One row as `enquiries/page.tsx` selects it — exported so that page can
 * annotate its query with it instead of casting, which is what would otherwise
 * let a dropped or un-blanked column through unnoticed.
 */
export type Enquiry = {
  id: number;
  branchId: number;
  name: string;
  sex: "male" | "female" | "other" | null;
  phone: string | null;
  inquiryDate: string;
  note: string | null;
  status: "new" | "follow_up" | "joined" | "lost";
  followUpDate: string | null;
  lastContactedAt: Date | null;
  contactCount: number;
  convertedMemberId: number | null;
  /** Who logged it. Null on rows filed before the column existed. */
  createdByName: string | null;
  createdAt: Date | null;
  branchCode: string | null;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialEnquiries: Enquiry[];
  showBranchColumn: boolean;
  branches: Branch[];
  currentBranchId: number | null;
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canSendWhatsApp?: boolean;
  /** Add-only: every row here is the viewer's own, so the creator is not shown. */
  ownOnly?: boolean;
};

type FilterKey = "due" | "open" | "joined" | "lost" | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "due", label: "Due" },
  { key: "open", label: "Open" },
  { key: "joined", label: "Joined" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "All" },
];

const STATUS_LABELS: Record<Enquiry["status"], string> = {
  new: "New",
  follow_up: "Following up",
  joined: "Joined",
  lost: "Not interested",
};

const SEX_LABELS: Record<NonNullable<Enquiry["sex"]>, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

const TEMPLATES: { id: EnquiryTemplateId; label: string }[] = [
  { id: "gentle", label: "Gentle check-in" },
  { id: "join_now", label: "Ready to join?" },
  { id: "hindi", label: "Hindi" },
];

/** "2026-10-02" → "2 Oct". Falls back to the raw string if it is not a date. */
function shortDate(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function EnquiryList({
  initialEnquiries,
  showBranchColumn,
  branches,
  currentBranchId,
  canAdd = true,
  canEdit = true,
  canDelete = true,
  canSendWhatsApp = true,
  ownOnly = false,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("due");
  const [creator, setCreator] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<Enquiry | null>(null);
  const [composing, setComposing] = useState<Enquiry | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const router = useRouter();

  const needsBranchPick = currentBranchId === null;
  const today = istDateString();

  /** Open and past its follow-up date — the people to chase today. */
  const isDue = (e: Enquiry) =>
    (e.status === "new" || e.status === "follow_up") &&
    !!e.followUpDate &&
    e.followUpDate <= today;

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      due: 0,
      open: 0,
      joined: 0,
      lost: 0,
      all: initialEnquiries.length,
    };
    for (const e of initialEnquiries) {
      if (isDue(e)) c.due += 1;
      if (e.status === "new" || e.status === "follow_up") c.open += 1;
      else c[e.status] += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEnquiries, today]);

  // Built from the rows already loaded — no extra query, and the chips are only
  // worth a row when more than one person has actually filed something. Rows
  // from before the creator column existed have no name and no chip.
  const creatorNames = useMemo(() => {
    const seen = new Set<string>();
    for (const e of initialEnquiries) {
      if (e.createdByName) seen.add(e.createdByName);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [initialEnquiries]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const matches = initialEnquiries.filter((e) => {
      if (creator && e.createdByName !== creator) return false;
      if (filter === "due" && !isDue(e)) return false;
      if (filter === "open" && e.status !== "new" && e.status !== "follow_up")
        return false;
      if (filter === "joined" && e.status !== "joined") return false;
      if (filter === "lost" && e.status !== "lost") return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.phone ?? "").toLowerCase().includes(q) ||
        (e.note ?? "").toLowerCase().includes(q)
      );
    });

    // Anyone past their follow-up date goes to the top, oldest slip first, so
    // the list opens on who has been waiting longest.
    return [...matches].sort((a, b) => {
      const ad = isDue(a);
      const bd = isDue(b);
      if (ad !== bd) return ad ? -1 : 1;
      if (ad && bd && a.followUpDate && b.followUpDate) {
        return a.followUpDate.localeCompare(b.followUpDate);
      }
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEnquiries, filter, searchQuery, creator, today]);

  // ===== HANDLERS =====
  async function handleAdd(formData: FormData) {
    setLoading(true);
    const result = await addEnquiryAction(formData);
    setLoading(false);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Enquiry saved!");
      setShowAddModal(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, formData: FormData) {
    setLoading(true);
    const result = await updateEnquiryAction(id, formData);
    setLoading(false);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Enquiry updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(enquiry: Enquiry) {
    if (!confirm(`Delete ${enquiry.name} from the enquiry list?`)) return;

    setDeletingId(enquiry.id);
    const result = await deleteEnquiryAction(enquiry.id);
    setDeletingId(null);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Enquiry deleted!");
      router.refresh();
    }
  }

  async function setStatus(enquiry: Enquiry, status: Enquiry["status"]) {
    const result = await markEnquiryStatusAction(enquiry.id, status);
    if (result.error) toast.error(result.error);
    else {
      toast.success(
        status === "lost"
          ? `${enquiry.name} marked as not interested.`
          : `${enquiry.name} moved back to open.`
      );
      router.refresh();
    }
  }

  async function sendWhatsApp(enquiry: Enquiry, message: string) {
    if (!message.trim()) {
      toast.error("Message is empty.");
      return;
    }
    if (!hasDialablePhone(enquiry.phone)) {
      toast.error(`${enquiry.name} has no phone number on file.`);
      return;
    }

    window.open(buildWhatsAppLink(enquiry.phone!, message), "_blank", "noopener,noreferrer");
    setComposing(null);

    // Best-effort bookkeeping, after the tab is open. A failure here must not
    // read as a failed send.
    const logged = await logEnquiryContactAction(enquiry.id);
    if (!logged.error) router.refresh();
  }

  function addAsMember(enquiry: Enquiry) {
    router.push(`/admin/members?fromEnquiry=${enquiry.id}`);
  }

  return (
    <div className="adm-pagebody">
      <div className="adm-search-row">
        <div className="adm-search">
          <Search size={16} />
          <input
            type="search"
            inputMode="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, note…"
            aria-label="Search enquiries"
          />
        </div>
      </div>

      <div className="adm-chips" role="tablist" aria-label="Filter enquiries">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`adm-chip${filter === f.key ? " active" : ""}`}
          >
            {f.label} {counts[f.key] > 0 && `· ${counts[f.key]}`}
          </button>
        ))}
      </div>

      {/* Only for an account that can see the whole list, and only once there is
          more than one author to tell apart. */}
      {!ownOnly && creatorNames.length > 1 && (
        <div className="adm-chips" style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setCreator(null)}
            className={`adm-chip${creator === null ? " active" : ""}`}
          >
            Everyone
          </button>
          {creatorNames.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCreator(n)}
              className={`adm-chip${creator === n ? " active" : ""}`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <div className="adm-toolbar">
        {canAdd && (
          <button
            type="button"
            className="adm-btn primary adm-desk-only"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} /> Add Enquiry
          </button>
        )}
        {/* Not for an add-only account: the importer answers with a skip count
            taken from the whole branch's list, which is the read this mode is
            there to refuse. The action refuses it too. */}
        {canAdd && !ownOnly && (
          <button
            type="button"
            className="adm-btn"
            onClick={() => setShowImport(true)}
          >
            <Upload size={15} /> Import
          </button>
        )}
        <span className="adm-toolbar-count">{filtered.length} shown</span>
      </div>

      <div className="adm-cardlist">
        {filtered.length === 0 ? (
          <div className="adm-empty">
            <div className="adm-empty-icon">
              <Inbox size={22} />
            </div>
            <p className="adm-empty-title">
              {filter === "due" ? "Nobody to chase" : "No enquiries found"}
            </p>
            <p className="adm-empty-text">
              {searchQuery
                ? "Try a different search."
                : filter === "due"
                ? "No follow-up date has come round yet. Open shows everyone still deciding."
                : filter === "all"
                ? "Add your first enquiry with the + button."
                : "Nothing in this filter yet."}
            </p>
          </div>
        ) : (
          filtered.map((e) => {
            const due = isDue(e);
            const closed = e.status === "joined" || e.status === "lost";
            return (
              <article
                key={e.id}
                className="adm-rec"
                style={closed ? { opacity: 0.62 } : undefined}
              >
                <div className="adm-rec-top">
                  <div className="adm-rec-ava">{e.name.charAt(0)}</div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="adm-rec-id">
                      Enquired {shortDate(e.inquiryDate) || e.inquiryDate}
                    </div>
                    <div className="adm-rec-name">{e.name}</div>
                    <div className="adm-rec-tags">
                      <span
                        className={`adm-tag ${
                          e.status === "joined"
                            ? "ok"
                            : e.status === "lost"
                            ? "off"
                            : due
                            ? "warn"
                            : ""
                        }`}
                      >
                        {STATUS_LABELS[e.status]}
                      </span>
                      {due && (
                        <span className="adm-tag warn">
                          Follow up {shortDate(e.followUpDate)}
                        </span>
                      )}
                      {e.sex && <span className="adm-tag">{SEX_LABELS[e.sex]}</span>}
                      {showBranchColumn && e.branchCode && (
                        <span className="adm-tag gold">{e.branchCode}</span>
                      )}
                      {!ownOnly && e.createdByName && (
                        <span className="adm-tag">by {e.createdByName}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="adm-rec-grid">
                  <div>
                    <div className="adm-rec-k">Phone</div>
                    {hasDialablePhone(e.phone) ? (
                      <a href={`tel:${e.phone}`} className="adm-rec-v adm-link">
                        <Phone size={11} /> {e.phone}
                      </a>
                    ) : (
                      <div className="adm-rec-v" style={{ color: "var(--text3)" }}>
                        Not on file
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="adm-rec-k">Follow-up</div>
                    <div className="adm-rec-v">
                      {e.followUpDate ? shortDate(e.followUpDate) : "Not set"}
                    </div>
                  </div>
                  <div>
                    <div className="adm-rec-k">Contacted</div>
                    <div className="adm-rec-v">
                      {e.contactCount > 0
                        ? `${e.contactCount}× · ${shortDate(
                            e.lastContactedAt
                              ? istDateString(new Date(e.lastContactedAt))
                              : null
                          )}`
                        : "Never"}
                    </div>
                  </div>
                </div>

                {e.note && (
                  <p className="adm-hint" style={{ marginTop: 8 }}>
                    {e.note}
                  </p>
                )}

                <div className="adm-rec-foot">
                  {canSendWhatsApp && !closed && (
                    <button
                      type="button"
                      onClick={() => setComposing(e)}
                      className="adm-act green"
                      aria-label={`WhatsApp ${e.name}`}
                    >
                      <MessageCircle size={15} />
                      <span className="adm-act-label">
                        {e.contactCount > 0 ? "WhatsApp again" : "WhatsApp"}
                      </span>
                    </button>
                  )}

                  {canEdit && !closed && (
                    <button
                      type="button"
                      onClick={() => addAsMember(e)}
                      className="adm-act"
                      style={{ color: "var(--green2)" }}
                      aria-label={`Add ${e.name} as a member`}
                    >
                      <UserCheck size={15} />
                      <span className="adm-act-label">Joined</span>
                    </button>
                  )}

                  {canEdit && !closed && (
                    <button
                      type="button"
                      onClick={() => setStatus(e, "lost")}
                      className="adm-act"
                      aria-label={`Mark ${e.name} as not interested`}
                    >
                      <UserX size={15} />
                      <span className="adm-act-label">Not interested</span>
                    </button>
                  )}

                  {canEdit && closed && (
                    <button
                      type="button"
                      onClick={() => setStatus(e, "new")}
                      className="adm-act"
                      aria-label={`Reopen ${e.name}`}
                    >
                      <RotateCcw size={15} />
                      <span className="adm-act-label">Reopen</span>
                    </button>
                  )}

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
                      className="adm-act"
                      aria-label={`Edit ${e.name}`}
                    >
                      <Edit size={15} />
                      <span className="adm-act-label">Edit</span>
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(e)}
                      disabled={deletingId === e.id}
                      className="adm-act red"
                      aria-label={`Delete ${e.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {canAdd && (
        <button
          type="button"
          className="adm-fab"
          onClick={() => setShowAddModal(true)}
          aria-label="Add enquiry"
        >
          <Plus size={18} /> Enquiry
        </button>
      )}

      {showAddModal && canAdd && (
        <EnquiryFormModal
          title="Add Enquiry"
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAdd}
          loading={loading}
          needsBranchPick={needsBranchPick}
          branches={branches}
          today={today}
        />
      )}

      {editing && canEdit && (
        <EnquiryFormModal
          title="Edit Enquiry"
          onClose={() => setEditing(null)}
          onSubmit={(fd) => handleUpdate(editing.id, fd)}
          loading={loading}
          enquiry={editing}
          branches={branches}
          today={today}
        />
      )}

      {composing && (
        <WhatsAppComposeSheet
          enquiry={composing}
          onClose={() => setComposing(null)}
          onSend={sendWhatsApp}
        />
      )}

      {showImport && canAdd && (
        <EnquiryImportSheet
          branches={branches}
          currentBranchId={currentBranchId}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ===== WHATSAPP COMPOSE =====
/**
 * The owner sends these by hand, so this is a compose box rather than a send
 * button: the template only fills it in, and whatever is in the box at the end
 * is what goes.
 */
function WhatsAppComposeSheet({
  enquiry,
  onClose,
  onSend,
}: {
  enquiry: Enquiry;
  onClose: () => void;
  onSend: (e: Enquiry, message: string) => void;
}) {
  const [templateId, setTemplateId] = useState<EnquiryTemplateId>("gentle");
  const [edited, setEdited] = useState<string | null>(null);

  const message =
    edited ?? generateEnquiryMessage(templateId, { name: enquiry.name });

  return (
    <Sheet onClose={onClose} title={`WhatsApp: ${enquiry.name}`}>
      <div className="adm-field">
        <label className="adm-label" htmlFor="eq-template">
          Template
        </label>
        <select
          id="eq-template"
          value={templateId}
          // Changing the template discards hand edits deliberately: the box is
          // then showing the template that is actually selected, not a mix.
          onChange={(ev) => {
            setTemplateId(ev.target.value as EnquiryTemplateId);
            setEdited(null);
          }}
          className="adm-select"
        >
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="adm-field">
        <label className="adm-label" htmlFor="eq-message">
          Message
        </label>
        <textarea
          id="eq-message"
          rows={9}
          value={message}
          onChange={(ev) => setEdited(ev.target.value)}
          className="adm-textarea"
        />
      </div>

      {!hasDialablePhone(enquiry.phone) && (
        <p className="adm-hint" style={{ color: "var(--red2)" }}>
          No phone number on file — add one in Edit before sending.
        </p>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSend(enquiry, message)}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          <MessageCircle size={15} /> Open WhatsApp
        </button>
      </div>
    </Sheet>
  );
}

// ===== FORM MODAL (Add + Edit) =====
function EnquiryFormModal({
  title,
  onClose,
  onSubmit,
  loading,
  enquiry,
  needsBranchPick = false,
  branches,
  today,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
  loading: boolean;
  enquiry?: Enquiry;
  needsBranchPick?: boolean;
  branches: Branch[];
  today: string;
}) {
  const [followUp, setFollowUp] = useState(enquiry?.followUpDate ?? "");

  return (
    <Sheet onClose={onClose} title={title}>
      <form action={onSubmit}>
        {needsBranchPick && (
          <div className="adm-field">
            <label className="adm-label" htmlFor="ef-branch">
              Branch *
            </label>
            <select id="ef-branch" name="branchId" required className="adm-select">
              <option value="">-- Select branch --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="adm-form-grid">
          <Input
            label="Name"
            name="name"
            required
            defaultValue={enquiry?.name}
            colSpan
          />
          <Input
            label="Phone Number"
            name="phone"
            type="tel"
            defaultValue={enquiry?.phone ?? ""}
            placeholder="10-digit mobile"
          />
          <div className="adm-field">
            <label className="adm-label" htmlFor="ef-sex">
              Sex
            </label>
            <select
              id="ef-sex"
              name="sex"
              defaultValue={enquiry?.sex ?? ""}
              className="adm-select"
            >
              <option value="">Not recorded</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Input
            label="Date of Inquiry"
            name="inquiryDate"
            type="date"
            defaultValue={enquiry?.inquiryDate || today}
          />
          <div className="adm-field">
            <label className="adm-label" htmlFor="ef-followup">
              Follow-up Date
            </label>
            <input
              id="ef-followup"
              type="date"
              name="followUpDate"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="adm-input"
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                type="button"
                className="adm-chip"
                onClick={() => setFollowUp(addDaysIso(today, 3))}
              >
                +3 days
              </button>
              <button
                type="button"
                className="adm-chip"
                onClick={() => setFollowUp(addDaysIso(today, 7))}
              >
                +1 week
              </button>
              {followUp && (
                <button
                  type="button"
                  className="adm-chip"
                  onClick={() => setFollowUp("")}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="adm-field span2">
            <label className="adm-label" htmlFor="ef-note">
              Note
            </label>
            <textarea
              id="ef-note"
              name="note"
              rows={2}
              defaultValue={enquiry?.note ?? ""}
              placeholder="e.g. Monday, Thursday — wants to start after Diwali"
              className="adm-textarea"
            />
          </div>

          {enquiry && (
            <div className="adm-field">
              <label className="adm-label" htmlFor="ef-status">
                Status
              </label>
              <select
                id="ef-status"
                name="status"
                defaultValue={enquiry.status}
                className="adm-select"
              >
                <option value="new">New</option>
                <option value="follow_up">Following up</option>
                <option value="joined">Joined</option>
                <option value="lost">Not interested</option>
              </select>
            </div>
          )}
        </div>

        {enquiry?.convertedMemberId && (
          <p className="adm-hint" style={{ marginTop: 8 }}>
            <Users size={12} /> Joined as a member already.
          </p>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
          <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="adm-btn primary"
            style={{ flex: 2 }}
          >
            {loading ? "Saving…" : enquiry ? "Update Enquiry" : "Save Enquiry"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// ===== HELPERS =====
function Input({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  colSpan = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  colSpan?: boolean;
}) {
  const id = `ef-${name}`;
  return (
    <div className={`adm-field${colSpan ? " span2" : ""}`}>
      <label className="adm-label" htmlFor={id}>
        {label}
        {required && " *"}
      </label>
      <input
        id={id}
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="adm-input"
      />
    </div>
  );
}
