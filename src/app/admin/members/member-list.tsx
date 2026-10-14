"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addMemberAction,
  updateMemberAction,
  deleteMemberAction,
  renewMemberAction,
} from "@/app/actions/members";
import { getEnquiryForPrefill, markEnquiryStatusAction } from "@/app/actions/enquiries";
import {
  Plus,
  Download,
  FileSpreadsheet,
  Edit,
  Trash2,
  Search,
  History,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Phone,
  Users,
  MessageCircle,
  Copy,
} from "lucide-react";
import toast from "react-hot-toast";
import HistoryModal from "./history-modal";
import { Sheet } from "../sheet";
import type { MemberGender } from "@/db/schema";
import { formatINR, formatGymId, istDateString, addDaysIso } from "@/lib/utils";
import {
  memberMatches,
  SEARCH_SCOPES,
  type SearchScope,
} from "@/lib/member-search";
import {
  buildMemberUpdateMessage,
  buildWhatsAppLink,
  hasDialablePhone,
  type MemberChange,
} from "@/lib/whatsapp";

/**
 * One row as `admin/members/page.tsx` selects it — exported so that page can
 * annotate its query result with it instead of casting to `any`. The cast used
 * to hide the fact that `address` was never blanked for accounts that had it
 * hidden.
 */
export type Member = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  gymId: number;
  name: string;
  email: string | null;
  contactNumber: string;
  address: string | null;
  parentName: string | null;
  emergencyContact: string;
  feeAmount: number;
  joiningDate: string;
  membershipExpiry: string;
  /**
   * "full" is Cardio, "no_cardio" is Hardcore, "offline" is a member whose tier
   * was never recorded — which is what every imported row used to be, and what
   * an online join stores when its plan carries no cardio flag.
   */
  planType: "full" | "no_cardio" | "offline" | null;
  /** Null is "not recorded" — the state of every member on file before this column. */
  gender: MemberGender | null;
  leftGym: boolean;
  createdAt: Date | null;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialMembers: Member[];
  showBranchColumn: boolean;
  branches: Branch[];
  currentBranchId: number | null;
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  hiddenFields?: string[];
};

type FilterKey = "all" | "active" | "expiring" | "expired" | "left";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring" },
  { key: "expired", label: "Expired" },
  { key: "left", label: "Left" },
];

// Deliberately NOT a chip in the row above. Those five are mutually exclusive —
// picking one replaces the others — so a "Cardio" chip there would make "which
// cardio members are expiring" unanswerable, which is the question an owner
// actually has. This is a separate control that composes with them.
type PlanFilter = "all" | "full" | "no_cardio" | "offline";

const PLAN_FILTERS: { key: PlanFilter; label: string }[] = [
  { key: "all", label: "All plans" },
  { key: "full", label: "Cardio" },
  { key: "no_cardio", label: "Hardcore" },
  { key: "offline", label: "Not recorded" },
];

/** Like the plan filter: a separate control that composes with the status chips. */
type GenderFilter = "all" | "male" | "female" | "other" | "none";

const GENDER_FILTERS: { key: GenderFilter; label: string }[] = [
  { key: "all", label: "All genders" },
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "other", label: "Other" },
  { key: "none", label: "Not recorded" },
];

/** "male" → "Male". Rendered in the list and both exports. */
const GENDER_LABELS: Record<MemberGender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

const genderLabel = (g: Member["gender"]) => (g ? GENDER_LABELS[g] : "Not recorded");

export default function MemberList({
  initialMembers,
  showBranchColumn,
  branches,
  currentBranchId,
  canAdd = true,
  canEdit = true,
  canDelete = true,
  hiddenFields = [],
}: Props) {
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  // One press can reach the server twice: a ghost click, or a second press before
  // `loading` has re-rendered the button. A ref is the only lock that closes
  // before the next event does — and every form here writes, so the second call
  // is a second member, a second edit, or a second renewal and its payment row.
  const inFlight = useRef(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Drives the "send them the update" sheet. Set after an edit or a renewal
  // that actually changed something, and with no changes at all by the standing
  // WhatsApp button on a row.
  const [updatePrompt, setUpdatePrompt] = useState<{
    member: Member;
    changes: MemberChange[];
    expiry: string;
    feeAmount?: number;
  } | null>(null);
  const [prefill, setPrefill] = useState<{
    name: string;
    phone: string;
    sex?: MemberGender | null;
  } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromEnquiryId = Number(searchParams.get("fromEnquiry")) || null;
  // Held separately from the URL: the param is stripped as soon as it is read,
  // and the link back to the enquiry has to survive that.
  const [enquiryId, setEnquiryId] = useState<number | null>(null);

  const hide = (field: string) => hiddenFields.includes(field);
  const needsBranchPick = currentBranchId === null;

  // Arriving from the enquiry list's "Joined" button. The enquiry is only
  // marked joined once a member is actually saved — see handleAdd.
  useEffect(() => {
    if (!fromEnquiryId || !canAdd) return;
    let cancelled = false;

    getEnquiryForPrefill(fromEnquiryId).then((r) => {
      if (cancelled || "error" in r) return;
      setEnquiryId(fromEnquiryId);
      setPrefill({ name: r.name, phone: r.phone, sex: r.sex });
      setShowAddModal(true);
      // Dropped from the URL, so reloading the page — or coming back to it —
      // does not reopen this form for someone who has already been added.
      router.replace("/admin/members");
    });

    return () => {
      cancelled = true;
    };
  }, [fromEnquiryId, canAdd, router]);

  // ===== EXPORT TO EXCEL (Owner's format) =====
  // exceljs is ~1MB parsed, and it is only ever needed once the owner actually
  // clicks Export. Loading it on demand keeps it out of the admin page bundle.
  const exportToExcel = async () => {
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Members");

      // Build headers in OWNER'S order
      const headers = ["Branch", "M.No"];
      if (!hide("feeAmount")) headers.push("Fees");
      headers.push("Name", "Gender");
      if (!hide("address")) headers.push("Address");
      if (!hide("parentName")) headers.push("Father Name");
      headers.push("Ph.No", "Joining Date", "Due Date");
      if (!hide("email")) headers.push("Email");
      if (!hide("emergencyContact")) headers.push("Emergency Contact");

      sheet.addRow(headers);

      // Style header
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FF000000" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAB308" }, // yellow-500
      };
      headerRow.alignment = { vertical: "middle", horizontal: "left" };
      headerRow.height = 22;

      // Add data. The M.No is written back in the register's own spelling —
      // "C-1295" — so an exported sheet and the book it came from read the same,
      // and so re-importing this file lands each member on the same row.
      initialMembers.forEach((m) => {
        const row: (string | number)[] = [
          m.branchName || "",
          formatGymId(m.gymId, m.planType),
        ];
        if (!hide("feeAmount"))
          row.push(`₹${m.feeAmount.toLocaleString("en-IN")}`);
        row.push(m.name, genderLabel(m.gender));
        if (!hide("address")) row.push(m.address || "");
        if (!hide("parentName")) row.push(m.parentName || "");
        row.push(m.contactNumber, m.joiningDate, m.membershipExpiry);
        if (!hide("email")) row.push(m.email || "");
        if (!hide("emergencyContact")) row.push(m.emergencyContact);
        sheet.addRow(row);
      });

      // Auto-width columns
      sheet.columns.forEach((col) => (col.width = 18));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "BrothersGym_Members.xlsx";
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Excel downloaded!");
    } catch (err) {
      console.error("Excel export error:", err);
      toast.error("Failed to export Excel");
    }
  };

  const exportToPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.text("Brothers Gym - Members List", 14, 15);

    const cols: string[] = [
      "Branch", "M.No", "Name", "Gender", "Ph.No", "Joining", "Due Date",
    ];
    if (!hide("feeAmount")) cols.push("Fees");

    const rows = initialMembers.map((m) => {
      const row: (string | number)[] = [
        m.branchCode || "-",
        formatGymId(m.gymId, m.planType),
        m.name,
        genderLabel(m.gender),
        m.contactNumber,
        m.joiningDate,
        m.membershipExpiry,
      ];
      if (!hide("feeAmount")) {
        row.push(`₹${m.feeAmount.toLocaleString("en-IN")}`);
      }
      return row;
    });

    autoTable(doc, { head: [cols], body: rows, startY: 20 });
    doc.save("BrothersGym_Members.pdf");
    toast.success("PDF downloaded!");
  };

  async function handleAdd(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await addMemberAction(formData);

      if (result.error) toast.error(result.error);
      else {
        // The enquiry that sent us here counts as joined only now that the member
        // exists, so the link back to them is written here rather than on the
        // button that started this. A refusal is reported instead of swallowed —
        // otherwise the enquiry stays on the call list with nothing to explain it.
        if (enquiryId && "memberId" in result && result.memberId) {
          const marked = await markEnquiryStatusAction(
            enquiryId,
            "joined",
            result.memberId
          );
          if ("error" in marked) {
            toast.error(`Member added, but the enquiry is still open: ${marked.error}`);
          }
        }
        toast.success("Member added successfully!");
        setShowAddModal(false);
        setPrefill(null);
        setEnquiryId(null);
        router.refresh();
      }
    } catch {
      // Silence here reads as "nothing was saved" — the one answer that gets the
      // form submitted a second time, which is how a member gets added twice.
      toast.error("No answer from the server — check the members list before saving again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function handleUpdate(id: number, formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await updateMemberAction(id, formData);

      // Narrowed rather than read optimistically: updateMemberAction returns a
      // real union, so `changes` does not exist on the error branch.
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Member updated successfully!");
        const member = editingMember;
        setShowEditModal(false);
        setEditingMember(null);

        // Offered only when something actually changed. `changes` is computed on
        // the server, so a field this account cannot write is never announced.
        if (member && result.changes.length > 0) {
          setUpdatePrompt({
            member: {
              ...member,
              contactNumber: String(
                formData.get("contactNumber") || member.contactNumber
              ),
            },
            changes: result.changes,
            expiry: String(
              formData.get("membershipExpiry") || member.membershipExpiry
            ),
            feeAmount: hide("feeAmount")
              ? undefined
              : Number(formData.get("feeAmount")) || member.feeAmount,
          });
        }
        router.refresh();
      }
    } catch {
      toast.error("No answer from the server — the edit may not have been saved.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this member? This cannot be undone.")) return;

    setDeletingId(id);
    const result = await deleteMemberAction(id);
    setDeletingId(null);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Member deleted!");
      router.refresh();
    }
  }

  async function handleRenewSubmit(formData: FormData) {
    if (!showRenewModal || inFlight.current) return;
    const member = showRenewModal;
    const amount = Number(formData.get("amount"));
    const duration = Number(formData.get("duration"));
    const planType = formData.get("planType") as "full" | "no_cardio" | "offline";
    const method = formData.get("method") as "cash" | "upi" | "razorpay" | "other";

    inFlight.current = true;
    setLoading(true);
    try {
      const r = await renewMemberAction(
        member.id,
        amount,
        duration,
        planType,
        method
      );

      // Narrowed rather than read optimistically: renewMemberAction returns a
      // real union now that its body is a transaction, so `r.error` is not
      // guaranteed to exist on the success branch.
      if ("error" in r && r.error) toast.error(r.error);
      else if ("newExpiry" in r) {
        toast.success(`Renewed till ${r.newExpiry}`);
        setShowRenewModal(null);
        setUpdatePrompt({
          member,
          changes: r.changes,
          expiry: r.newExpiry,
          feeAmount: amount,
        });
        router.refresh();
      }
    } catch {
      // A call that never answered says nothing about whether the renewal was
      // recorded, so it must not read as "nothing happened, press it again".
      toast.error("No answer from the server — check the due date before renewing again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function openEditModal(member: Member) {
    setEditingMember(member);
    setShowEditModal(true);
  }

  // Both are date-only strings, so a re-render can only ever change them at
  // midnight — and if the owner has the list open at midnight, the fresher
  // answer is the correct one. IST rather than the browser's UTC offset, so
  // the list agrees with the dashboard and with what the server wrote.
  const today = istDateString();
  const soon = addDaysIso(today, 7);

  /** Membership state, derived once so the tag, the chip filter and the counts
   *  can never disagree about who is expiring. */
  function statusOf(m: Member): Exclude<FilterKey, "all"> {
    if (m.leftGym) return "left";
    if (m.membershipExpiry < today) return "expired";
    if (m.membershipExpiry < soon) return "expiring";
    return "active";
  }

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: initialMembers.length,
      active: 0,
      expiring: 0,
      expired: 0,
      left: 0,
    };
    initialMembers.forEach((m) => {
      c[statusOf(m)] += 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMembers, today, soon]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return initialMembers.filter((m) => {
      if (filter !== "all" && statusOf(m) !== filter) return false;
      if (planFilter !== "all" && (m.planType ?? "offline") !== planFilter)
        return false;
      if (genderFilter !== "all") {
        // "none" is the absence of a value, so it cannot be an equality test.
        const wanted = genderFilter === "none" ? null : genderFilter;
        if (m.gender !== wanted) return false;
      }
      if (!q) return true;

      return memberMatches(m, q, searchScope, hide);
    });
    // `hide` and `statusOf` are fresh closures each render but read nothing
    // except hiddenFields and the two date strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMembers, searchQuery, searchScope, filter, planFilter, genderFilter, hiddenFields, today, soon]);

  // Column count for the desktop table's empty state
  let visibleColCount = 7; // M.No, Name, Gender, Ph.No, Joining, Due Date, Actions
  if (showBranchColumn) visibleColCount += 1;
  if (!hide("feeAmount")) visibleColCount += 1;
  if (!hide("address")) visibleColCount += 1;
  if (!hide("parentName")) visibleColCount += 1;

  // Shared by the mobile cards and the desktop table so the two can't drift.
  const RowActions = ({ m }: { m: Member }) => (
    <>
      <button
        onClick={() => setHistoryMember(m)}
        className="adm-act"
        title="Payment History"
        aria-label={`Payment history for ${m.name}`}
      >
        <History size={15} />
        <span className="adm-act-label">History</span>
      </button>
      {canEdit && (
        <button
          onClick={() => setShowRenewModal(m)}
          className="adm-act green"
          title="Renew Membership"
          aria-label={`Renew membership for ${m.name}`}
        >
          <RefreshCw size={15} />
          <span className="adm-act-label">Renew</span>
        </button>
      )}
      {canEdit && (
        <button
          onClick={() =>
            setUpdatePrompt({
              member: m,
              changes: [],
              expiry: m.membershipExpiry,
              // Blanked rather than sent when this account cannot see fees,
              // which is the same value the list itself is rendered from.
              feeAmount: hide("feeAmount") ? undefined : m.feeAmount,
            })
          }
          className="adm-act"
          style={{ color: "var(--green2)" }}
          title="Send their details on WhatsApp"
          aria-label={`WhatsApp ${m.name}`}
        >
          <MessageCircle size={15} />
          <span className="adm-act-label">WhatsApp</span>
        </button>
      )}
      {canEdit && (
        <button
          onClick={() => openEditModal(m)}
          className="adm-act icon"
          title="Edit"
          aria-label={`Edit ${m.name}`}
        >
          <Edit size={15} />
        </button>
      )}      {canDelete && (
        <button
          onClick={() => handleDelete(m.id)}
          disabled={deletingId === m.id}
          className="adm-act icon red"
          title="Delete"
          aria-label={`Delete ${m.name}`}
        >
          <Trash2 size={15} />
        </button>
      )}
    </>
  );

  return (
    <div className="adm-pagebody">
      {/* Search sits above the chips: on a phone the owner is usually looking
          for one person by number, not browsing a filtered list.

          Four controls, laid out by .adm-search-row: the scope, then the box,
          then the two filters. The filters are selects rather than chips so they
          narrow the list *alongside* the status filter instead of replacing it,
          and the scope is there because one box cannot know whether "1" is an
          M.No, a name or the first digit of a phone number. */}
      <div className="adm-search-row adm-search-row-filters">
        <select
          value={searchScope}
          onChange={(e) => setSearchScope(e.target.value as SearchScope)}
          className="adm-select adm-search-scope"
          aria-label="What to search"
        >
          {SEARCH_SCOPES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="adm-search">
          <Search size={16} />
          <input
            type="search"
            inputMode="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              SEARCH_SCOPES.find((s) => s.key === searchScope)?.placeholder ?? ""
            }
            aria-label="Search members"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
          className="adm-select adm-plan-filter"
          aria-label="Filter by plan type"
        >
          {PLAN_FILTERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value as GenderFilter)}
          className="adm-select adm-plan-filter"
          aria-label="Filter by gender"
        >
          {GENDER_FILTERS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <div className="adm-chips" role="tablist" aria-label="Filter members">
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

      {/* Exports are a desk task, not a gym-floor one, so they sit below the
          list controls rather than competing with search for the top of the
          screen. Add Member is the FAB on a phone, and — since the FAB is
          hidden on a laptop — a real button on this same row there. */}
      <div className="adm-toolbar">
        {canAdd && (
          <button
            type="button"
            className="adm-btn primary adm-desk-only"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} /> Add Member
          </button>
        )}
        <button onClick={exportToExcel} className="adm-btn" type="button">
          <FileSpreadsheet size={15} /> Excel
        </button>
        <button onClick={exportToPDF} className="adm-btn" type="button">
          <Download size={15} /> PDF
        </button>
        <span className="adm-toolbar-count">
          {filteredMembers.length} shown
        </span>
      </div>

      {/* ===== CARD LIST (phones and tablets) ===== */}
      <div className="adm-cardlist">
        {filteredMembers.length === 0 ? (
          <div className="adm-empty">
            <div className="adm-empty-icon">
              <Users size={22} />
            </div>
            <p className="adm-empty-title">No members found</p>
            <p className="adm-empty-text">
              {searchQuery || filter !== "all" || planFilter !== "all"
                ? "Try a different search or filter."
                : "Add your first member with the + button."}
            </p>
          </div>
        ) : (
          filteredMembers.map((m) => {
            const status = statusOf(m);
            return (
              <article
                key={m.id}
                className="adm-rec"
                style={m.leftGym ? { opacity: 0.62 } : undefined}
              >
                <div className="adm-rec-top">
                  <div className="adm-rec-ava">{m.name.charAt(0)}</div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="adm-rec-id">
                      M.No {formatGymId(m.gymId, m.planType)}
                    </div>
                    <div className="adm-rec-name">{m.name}</div>
                    <div className="adm-rec-tags">
                      <StatusTag
                        status={status}
                        expiry={m.membershipExpiry}
                        today={today}
                      />
                      <PlanTag planType={m.planType} />
                      {showBranchColumn && m.branchCode && (
                        <span className="adm-tag gold">{m.branchCode}</span>
                      )}
                    </div>
                  </div>

                  {!hide("feeAmount") && (
                    <div className="adm-rec-amt">{formatINR(m.feeAmount)}</div>
                  )}
                </div>

                <div className="adm-rec-grid">
                  <div>
                    <div className="adm-rec-k">Phone</div>
                    {hasDialablePhone(m.contactNumber) ? (
                      <a
                        href={`tel:${m.contactNumber}`}
                        className="adm-rec-v adm-link"
                      >
                        <Phone size={11} /> {m.contactNumber}
                      </a>
                    ) : (
                      <div className="adm-rec-v" style={{ color: "var(--text3)" }}>
                        Not on file
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="adm-rec-k">Due</div>
                    <div
                      className="adm-rec-v"
                      style={{
                        color:
                          status === "expired"
                            ? "var(--red2)"
                            : status === "expiring"
                            ? "var(--orange)"
                            : undefined,
                      }}
                    >
                      {m.membershipExpiry}
                    </div>
                  </div>
                  <div>
                    <div className="adm-rec-k">Joined</div>
                    <div className="adm-rec-v">{m.joiningDate}</div>
                  </div>
                  <div>
                    <div className="adm-rec-k">Gender</div>
                    <div
                      className="adm-rec-v"
                      style={m.gender ? undefined : { color: "var(--text3)" }}
                    >
                      {genderLabel(m.gender)}
                    </div>
                  </div>
                  {!hide("parentName") && (
                    <div>
                      <div className="adm-rec-k">Father</div>
                      <div className="adm-rec-v">{m.parentName || "—"}</div>
                    </div>
                  )}
                </div>

                <div className="adm-rec-foot">
                  <RowActions m={m} />
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* ===== DESKTOP TABLE — columns in OWNER'S order =====
          Above 900px there is room for the full row, and scanning a real table
          beats reading 40 cards. */}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              {showBranchColumn && <th>Branch</th>}
              <th>M.No</th>
              {!hide("feeAmount") && <th>Fees</th>}
              <th>Name</th>
              <th>Gender</th>
              {!hide("address") && <th>Address</th>}
              {!hide("parentName") && <th>Father Name</th>}
              <th>Ph.No</th>
              <th>Joining Date</th>
              <th>Due Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount} style={{ textAlign: "center" }}>
                  No members found.
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => {
                const status = statusOf(m);
                return (
                  <tr key={m.id} style={m.leftGym ? { opacity: 0.55 } : undefined}>
                    {showBranchColumn && (
                      <td>
                        <span className="adm-tag gold">{m.branchCode}</span>
                      </td>
                    )}
                    <td style={{ fontWeight: 700, color: "var(--text)" }}>
                      {formatGymId(m.gymId, m.planType)}
                    </td>
                    {!hide("feeAmount") && (
                      <td style={{ color: "var(--green2)", fontWeight: 700 }}>
                        {formatINR(m.feeAmount)}
                      </td>
                    )}
                    <td style={{ color: "var(--text)" }}>
                      {m.name}
                      <PlanTag planType={m.planType} spaced />
                      {m.leftGym && (
                        <span className="adm-tag off" style={{ marginLeft: 8 }}>
                          Left
                        </span>
                      )}
                    </td>
                    <td style={m.gender ? undefined : { color: "var(--text3)" }}>
                      {genderLabel(m.gender)}
                    </td>
                    {!hide("address") && (
                      <td className="adm-td-clip">{m.address || "—"}</td>
                    )}
                    {!hide("parentName") && <td>{m.parentName || "—"}</td>}
                    <td>{m.contactNumber || "—"}</td>
                    <td style={{ color: "var(--blue2)" }}>{m.joiningDate}</td>
                    <td>
                      <span
                        style={{
                          color:
                            status === "expired"
                              ? "var(--red2)"
                              : status === "expiring"
                              ? "var(--orange)"
                              : undefined,
                          fontWeight: status === "active" ? 400 : 700,
                        }}
                      >
                        {m.membershipExpiry}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <RowActions m={m} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canAdd && (
        <button
          type="button"
          className="adm-fab"
          onClick={() => setShowAddModal(true)}
          aria-label="Add member"
        >
          <Plus size={18} /> Member
        </button>
      )}

      {/* ===== ADD MODAL ===== */}
      {showAddModal && canAdd && (
        <MemberFormModal
          title={prefill ? "New Member (from enquiry)" : "Add New Member"}
          onClose={() => {
            setShowAddModal(false);
            setPrefill(null);
          }}
          onSubmit={handleAdd}
          loading={loading}
          needsBranchPick={needsBranchPick}
          branches={branches}
          hiddenFields={hiddenFields}
          today={today}
          prefill={prefill}
        />
      )}

      {/* ===== EDIT MODAL ===== */}
      {showEditModal && editingMember && canEdit && (
        <MemberFormModal
          title="Edit Member"
          onClose={() => setShowEditModal(false)}
          onSubmit={(fd) => handleUpdate(editingMember.id, fd)}
          loading={loading}
          member={editingMember}
          branches={branches}
          hiddenFields={hiddenFields}
          today={today}
        />
      )}

      {/* ===== RENEW MODAL ===== */}
      {showRenewModal && canEdit && (
        <Sheet
          onClose={() => setShowRenewModal(null)}
          title={`Renew: ${showRenewModal.name}`}
        >
          <form action={handleRenewSubmit}>
            <p className="adm-hint" style={{ marginBottom: 14 }}>
              Current due date:{" "}
              <strong style={{ color: "var(--text)" }}>
                {showRenewModal.membershipExpiry}
              </strong>
            </p>

            <div className="adm-form-grid">
              <div className="adm-field">
                <label className="adm-label" htmlFor="renew-amount">
                  Fees (₹) *
                </label>
                <input
                  id="renew-amount"
                  type="number"
                  name="amount"
                  required
                  min={1}
                  // Not pre-filled when fees are hidden from this account: the
                  // last fee is exactly the number being concealed, and it is
                  // no longer sent to the browser anyway. Whoever took the money
                  // types what they took.
                  defaultValue={
                    hide("feeAmount") ? undefined : showRenewModal.feeAmount
                  }
                  className="adm-input"
                />
                {hide("feeAmount") && (
                  <p className="adm-hint">Enter the amount collected.</p>
                )}              </div>
              <div className="adm-field">
                <label className="adm-label" htmlFor="renew-duration">
                  Duration *
                </label>
                <select
                  id="renew-duration"
                  name="duration"
                  required
                  defaultValue="30"
                  className="adm-select"
                >
                  <option value="30">1 Month (30 days)</option>
                  <option value="90">3 Months (90 days)</option>
                  <option value="180">6 Months (180 days)</option>
                  <option value="365">12 Months (365 days)</option>
                </select>
              </div>
              <div className="adm-field">
                <label className="adm-label" htmlFor="renew-plan">
                  Plan Type
                </label>
                <select
                  id="renew-plan"
                  name="planType"
                  defaultValue="offline"
                  className="adm-select"
                >
                  <option value="full">Cardio (Full)</option>
                  <option value="no_cardio">Hardcore (No Cardio)</option>
                  <option value="offline">Offline (default)</option>
                </select>
              </div>
              <div className="adm-field">
                <label className="adm-label" htmlFor="renew-method">
                  Payment Method
                </label>
                <select
                  id="renew-method"
                  name="method"
                  defaultValue="cash"
                  className="adm-select"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="razorpay">Razorpay</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="adm-btn primary block"
              style={{ marginTop: 8 }}
            >
              {loading ? "Renewing…" : "Confirm Renewal"}
            </button>
          </form>
        </Sheet>
      )}

      {historyMember && (
        <HistoryModal
          memberId={historyMember.id}
          onClose={() => setHistoryMember(null)}
        />
      )}

      {updatePrompt && (
        <MemberUpdateSheet
          member={updatePrompt.member}
          changes={updatePrompt.changes}
          expiry={updatePrompt.expiry}
          feeAmount={updatePrompt.feeAmount}
          onClose={() => setUpdatePrompt(null)}
        />
      )}
    </div>
  );
}

/**
 * The member's tier, which the list never showed before — the only place these
 * words appeared in the whole admin was the Renew box's dropdown, so an imported
 * member's cardio flag was stored and then invisible. Three existing tag
 * modifiers, so this needs no new CSS: gold is the cardio tier, blue the
 * weights-only tier, and muted is "never recorded" — the value every imported
 * row used to carry, kept visible so a half-migrated list is obvious rather than
 * silently reading as Hardcore.
 */
function PlanTag({
  planType,
  /** In the desktop table the tag sits inline after the name rather than in a
   *  tag row, so it needs its own gap. */
  spaced,
}: {
  planType: Member["planType"];
  spaced?: boolean;
}) {
  if (!planType) return null;
  if (planType === "full")
    return (
      <span className="adm-tag gold" style={spaced ? { marginLeft: 8 } : undefined}>
        Cardio
      </span>
    );
  if (planType === "no_cardio")
    return (
      <span className="adm-tag info" style={spaced ? { marginLeft: 8 } : undefined}>
        Hardcore
      </span>
    );
  return (
    <span className="adm-tag muted" style={spaced ? { marginLeft: 8 } : undefined}>
      Not recorded
    </span>
  );
}

function StatusTag({
  status,
  expiry,
  /** Passed in rather than read from the clock here, so the countdown and the
   *  status chips are always measured from the same day. */
  today,
}: {
  status: Exclude<FilterKey, "all">;
  expiry: string;
  today: string;
}) {
  if (status === "left") return <span className="adm-tag off">Left</span>;
  if (status === "expired") return <span className="adm-tag off">Expired</span>;
  if (status === "expiring") {
    const days = Math.max(
      0,
      Math.round(
        (new Date(expiry).getTime() - new Date(today).getTime()) / 86400000
      )
    );
    return (
      <span className="adm-tag warn">{days === 0 ? "Due today" : `${days}d left`}</span>
    );
  }
  return <span className="adm-tag ok">Active</span>;
}

// ===== SEND UPDATE ON WHATSAPP =====
/**
 * Shown after an edit or a renewal that changed something, and by the WhatsApp
 * button on a row.
 *
 * With changes it leads with what changed, old → new, so the owner can check
 * the message against the numbers before sending. With none it is just a
 * compose box holding the member's current details.
 *
 * Nothing is sent from here. `wa.me` opens the owner's own WhatsApp with this
 * text in the box — he presses send, and it comes from his number.
 */
function MemberUpdateSheet({
  member,
  changes,
  expiry,
  feeAmount,
  onClose,
}: {
  member: Member;
  changes: MemberChange[];
  expiry: string;
  feeAmount?: number;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(() =>
    buildMemberUpdateMessage({
      name: member.name,
      gymId: member.gymId,
      changes,
      expiry,
      feeAmount,
    })
  );

  const dialable = hasDialablePhone(member.contactNumber);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Copied.");
    } catch {
      // Clipboard access throws in an insecure context or without permission.
      // The text is on screen and selectable, so this is not worth an error.
      toast.error("Could not copy — select the text instead.");
    }
  }

  function send() {
    if (!message.trim()) {
      toast.error("Message is empty.");
      return;
    }
    if (!dialable) {
      toast.error(`${member.name} has no phone number on file.`);
      return;
    }
    window.open(
      buildWhatsAppLink(member.contactNumber, message),
      "_blank",
      "noopener,noreferrer"
    );
    onClose();
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        changes.length > 0 ? `Update: ${member.name}` : `WhatsApp: ${member.name}`
      }
    >
      {changes.length > 0 && (
        <>
          <p className="adm-label">What changed</p>
          <ul className="adm-bullets" style={{ marginBottom: 14 }}>
            {changes.map((c) => (
              <li key={c.field}>
                {c.label}: <strong>{c.from}</strong> → <strong>{c.to}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      {!dialable && (
        <p className="adm-hint" style={{ color: "var(--red2)" }}>
          No phone number on file — add one in Edit before sending.
        </p>
      )}

      <div className="adm-field">
        <label className="adm-label" htmlFor="mu-message">
          Message
        </label>
        <textarea
          id="mu-message"
          rows={9}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="adm-textarea"
        />
      </div>

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Skip
        </button>
        <button
          type="button"
          onClick={copyMessage}
          className="adm-btn"
          style={{ flex: 1 }}
        >
          <Copy size={15} /> Copy
        </button>
        <button
          type="button"
          onClick={send}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          <MessageCircle size={15} /> Open WhatsApp
        </button>
      </div>
    </Sheet>
  );
}

// ===== MEMBER FORM MODAL (Add + Edit) =====
function MemberFormModal({
  title,
  onClose,
  onSubmit,
  loading,
  member,
  needsBranchPick = false,
  branches,
  hiddenFields,
  today,
  prefill,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
  loading: boolean;
  member?: Member;
  needsBranchPick?: boolean;
  branches: Branch[];
  hiddenFields: string[];
  today: string;
  /** Name, phone and sex carried over from an enquiry. New members only. */
  prefill?: { name: string; phone: string; sex?: MemberGender | null } | null;
}) {
  const [showAdditional, setShowAdditional] = useState(false);
  const hide = (field: string) => hiddenFields.includes(field);

  return (
    <Sheet onClose={onClose} title={title}>
      <form action={onSubmit}>
        {needsBranchPick && (
          <div className="adm-field">
            <label className="adm-label" htmlFor="mf-branch">
              Branch *
            </label>
            <select id="mf-branch" name="branchId" required className="adm-select">
              <option value="">-- Select branch --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* PRIMARY FIELDS — Owner's exact order */}
        <div className="adm-form-grid">
          <Input
            label="M.No (Member Number)"
            name="gymId"
            type="number"
            required
            defaultValue={member?.gymId}
            placeholder="e.g. 1234"
          />
          {!hide("feeAmount") && (
            <Input
              label="Fees (₹)"
              name="feeAmount"
              type="number"
              required
              defaultValue={member?.feeAmount}
              placeholder="e.g. 1500"
            />
          )}
          <Input
            label="Name"
            name="name"
            required
            defaultValue={member?.name ?? prefill?.name}
            colSpan
          />
          {!hide("address") && (
            <Input
              label="Address"
              name="address"
              defaultValue={member?.address || ""}
              placeholder="Full address"
              colSpan
            />
          )}
          {!hide("parentName") && (
            <Input
              // Required when adding, optional when editing: members created
              // before this was mandatory have a blank one, and forcing it here
              // would block every unrelated edit to those rows.
              label="Father Name"
              name="parentName"
              required={!member}
              defaultValue={member?.parentName || ""}
              placeholder="e.g. Sh. Ram Kumar"
            />
          )}
          <Input
            label="Ph.No (Phone Number)"
            name="contactNumber"
            type="tel"
            required
            defaultValue={member?.contactNumber ?? prefill?.phone}
            placeholder="10-digit mobile"
          />
          <Input
            label="Joining Date"
            name="joiningDate"
            type="date"
            required
            defaultValue={member?.joiningDate || today}
          />
          <div className="adm-field">
            <label className="adm-label" htmlFor="mf-gender">
              Gender
            </label>
            <select
              id="mf-gender"
              name="gender"
              className="adm-select"
              // Blank means "not recorded", which is the state of everyone
              // already on file and an answer the owner is allowed to keep
              // giving. Carried over from the enquiry when there is one.
              defaultValue={member?.gender ?? prefill?.sex ?? ""}
            >
              <option value="">Not recorded</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Input
            label="Due Date (Expiry)"
            name="membershipExpiry"
            type="date"
            required
            defaultValue={member?.membershipExpiry}
          />
        </div>

        {/* ADDITIONAL INFO — Collapsed by default */}
        {(!hide("email") || !hide("emergencyContact")) && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <button
              type="button"
              onClick={() => setShowAdditional(!showAdditional)}
              className="adm-disclosure"
              aria-expanded={showAdditional}
            >
              <span>Additional Info (Optional)</span>
              {showAdditional ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {showAdditional && (
              <div className="adm-form-grid" style={{ marginTop: 10 }}>
                {!hide("email") && (
                  <Input
                    label="Email (Optional)"
                    name="email"
                    type="email"
                    defaultValue={member?.email || ""}
                    placeholder="member@gmail.com"
                    colSpan
                  />
                )}
                {!hide("emergencyContact") && (
                  <Input
                    label="Emergency Contact"
                    name="emergencyContact"
                    type="tel"
                    defaultValue={member?.emergencyContact}
                    placeholder="Family member phone"
                    colSpan
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* emergencyContact is NOT NULL in the schema, so a new member still
            needs something in the column even when the field is hidden from
            this account. On an EDIT there is no echo any more: the value is no
            longer sent to the browser, and updateMemberAction leaves a hidden
            column out of its SET list, so the stored contact survives on its
            own. */}
        {hide("emergencyContact") && !member && (
          <input type="hidden" name="emergencyContact" value="N/A" />
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
            {loading ? "Saving…" : member ? "Update Member" : "Save Member"}
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
  const id = `mf-${name}`;
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
