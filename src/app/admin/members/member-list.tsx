"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  addMemberAction,
  updateMemberAction,
  deleteMemberAction,
  renewMemberAction,
} from "@/app/actions/members";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
} from "lucide-react";
import toast from "react-hot-toast";
import HistoryModal from "./history-modal";
import { Sheet } from "../sheet";
import { formatINR } from "@/lib/utils";

type Member = {
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
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const router = useRouter();

  const hide = (field: string) => hiddenFields.includes(field);
  const needsBranchPick = currentBranchId === null;

  // ===== EXPORT TO EXCEL (Owner's format) =====
  const exportToExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Members");

      // Build headers in OWNER'S order
      const headers = ["Branch", "M.No"];
      if (!hide("feeAmount")) headers.push("Fees");
      headers.push("Name", "Address");
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

      // Add data
      initialMembers.forEach((m) => {
        const row: (string | number)[] = [m.branchName || "", m.gymId];
        if (!hide("feeAmount"))
          row.push(`₹${m.feeAmount.toLocaleString("en-IN")}`);
        row.push(m.name, m.address || "");
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

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("Brothers Gym - Members List", 14, 15);

    const cols: string[] = ["Branch", "M.No", "Name", "Ph.No", "Joining", "Due Date"];
    if (!hide("feeAmount")) cols.push("Fees");

    const rows = initialMembers.map((m) => {
      const row: (string | number)[] = [
        m.branchCode || "-",
        m.gymId,
        m.name,
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
    setLoading(true);
    const result = await addMemberAction(formData);
    setLoading(false);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Member added successfully!");
      setShowAddModal(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, formData: FormData) {
    setLoading(true);
    const result = await updateMemberAction(id, formData);
    setLoading(false);

    if (result.error) toast.error(result.error);
    else {
      toast.success("Member updated successfully!");
      setShowEditModal(false);
      setEditingMember(null);
      router.refresh();
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
    if (!showRenewModal) return;
    const amount = Number(formData.get("amount"));
    const duration = Number(formData.get("duration"));
    const planType = formData.get("planType") as "full" | "no_cardio" | "offline";
    const method = formData.get("method") as "cash" | "upi" | "razorpay" | "other";

    setLoading(true);
    const r = await renewMemberAction(
      showRenewModal.id,
      amount,
      duration,
      planType,
      method
    );
    setLoading(false);

    if (r.error) toast.error(r.error);
    else {
      toast.success(`Renewed till ${r.newExpiry}`);
      setShowRenewModal(null);
      router.refresh();
    }
  }

  function openEditModal(member: Member) {
    setEditingMember(member);
    setShowEditModal(true);
  }

  // Both are date-only strings, so a re-render can only ever change them at
  // midnight — and if the owner has the list open at midnight, the fresher
  // answer is the correct one.
  const today = new Date().toISOString().split("T")[0];
  // eslint-disable-next-line react-hooks/purity
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

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
      if (!q) return true;

      return (
        m.gymId.toString().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.email && !hide("email") && m.email.toLowerCase().includes(q)) ||
        m.contactNumber.includes(q) ||
        (m.address && m.address.toLowerCase().includes(q)) ||
        (m.parentName &&
          !hide("parentName") &&
          m.parentName.toLowerCase().includes(q)) ||
        (m.branchName && m.branchName.toLowerCase().includes(q))
      );
    });
    // `hide` and `statusOf` are fresh closures each render but read nothing
    // except hiddenFields and the two date strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMembers, searchQuery, filter, hiddenFields, today, soon]);

  // Column count for the desktop table's empty state
  let visibleColCount = 7; // M.No, Name, Ph.No, Address, Joining, Due Date, Actions
  if (showBranchColumn) visibleColCount += 1;
  if (!hide("feeAmount")) visibleColCount += 1;
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
          onClick={() => openEditModal(m)}
          className="adm-act icon"
          title="Edit"
          aria-label={`Edit ${m.name}`}
        >
          <Edit size={15} />
        </button>
      )}
      {canDelete && (
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
          for one person by number, not browsing a filtered list. */}
      <div className="adm-search">
        <Search size={16} />
        <input
          type="search"
          inputMode="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search M.No, name, phone…"
          aria-label="Search members"
        />
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
              {searchQuery || filter !== "all"
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
                    <div className="adm-rec-id">M.No {m.gymId}</div>
                    <div className="adm-rec-name">{m.name}</div>
                    <div className="adm-rec-tags">
                      <StatusTag
                        status={status}
                        expiry={m.membershipExpiry}
                        today={today}
                      />
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
                    <a
                      href={`tel:${m.contactNumber}`}
                      className="adm-rec-v adm-link"
                    >
                      <Phone size={11} /> {m.contactNumber}
                    </a>
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
              <th>Address</th>
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
                      {m.gymId}
                    </td>
                    {!hide("feeAmount") && (
                      <td style={{ color: "var(--green2)", fontWeight: 700 }}>
                        {formatINR(m.feeAmount)}
                      </td>
                    )}
                    <td style={{ color: "var(--text)" }}>
                      {m.name}
                      {m.leftGym && (
                        <span className="adm-tag off" style={{ marginLeft: 8 }}>
                          Left
                        </span>
                      )}
                    </td>
                    <td className="adm-td-clip">{m.address || "—"}</td>
                    {!hide("parentName") && <td>{m.parentName || "—"}</td>}
                    <td>{m.contactNumber}</td>
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
          title="Add New Member"
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAdd}
          loading={loading}
          needsBranchPick={needsBranchPick}
          branches={branches}
          hiddenFields={hiddenFields}
          today={today}
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
                  defaultValue={showRenewModal.feeAmount}
                  className="adm-input"
                />
              </div>
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
    </div>
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
            defaultValue={member?.name}
            colSpan
          />
          <Input
            label="Address"
            name="address"
            defaultValue={member?.address || ""}
            placeholder="Full address"
            colSpan
          />
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
            defaultValue={member?.contactNumber}
            placeholder="10-digit mobile"
          />
          <Input
            label="Joining Date"
            name="joiningDate"
            type="date"
            required
            defaultValue={member?.joiningDate || today}
          />
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

        {/* Hidden field for emergencyContact if not shown (still required by DB) */}
        {hide("emergencyContact") && member && (
          <input type="hidden" name="emergencyContact" value={member.emergencyContact} />
        )}
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
