"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Plus,
  Edit,
  Trash2,
  FileSpreadsheet,
  Phone,
  Briefcase,
  Search,
} from "lucide-react";
import {
  addStaffAction,
  updateStaffAction,
  deleteStaffAction,
} from "@/app/actions/staff";
import { formatINR, istDateString } from "@/lib/utils";
import { Sheet } from "../sheet";

/** One row as `admin/staff/page.tsx` selects it. Exported so that page can
 *  annotate its query instead of casting the prop to `any`. */
export type Staff = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  category: "Trainer" | "Worker" | "Cleaner";
  salary: number;
  contactNumber: string;
  address: string | null;
  joinDate: string;
  isActive: boolean;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialStaff: Staff[];
  showBranchColumn: boolean;
  branches: Branch[];
  currentBranchId: number | null;
  canEdit?: boolean;
};

type FilterKey = "all" | "Trainer" | "Worker" | "Cleaner" | "inactive";

export default function StaffList({
  initialStaff,
  showBranchColumn,
  branches,
  currentBranchId,
  canEdit = true,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const router = useRouter();

  const needsBranchPick = currentBranchId === null;
  const today = istDateString();

  // Only active staff are actually being paid, so the payroll figure ignores
  // inactive rows — the same rule the dashboard's salary total uses.
  const payroll = useMemo(
    () =>
      initialStaff
        .filter((s) => s.isActive)
        .reduce((sum, s) => sum + (Number(s.salary) || 0), 0),
    [initialStaff]
  );

  const counts = useMemo(() => {
    const c = {
      all: initialStaff.length,
      Trainer: 0,
      Worker: 0,
      Cleaner: 0,
      inactive: 0,
    };
    initialStaff.forEach((s) => {
      c[s.category] += 1;
      if (!s.isActive) c.inactive += 1;
    });
    return c;
  }, [initialStaff]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return initialStaff.filter((s) => {
      if (filter === "inactive" && s.isActive) return false;
      if (filter !== "all" && filter !== "inactive" && s.category !== filter)
        return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.contactNumber.includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.branchName && s.branchName.toLowerCase().includes(q))
      );
    });
  }, [initialStaff, search, filter]);

  async function handleAdd(fd: FormData) {
    setLoading(true);
    const r = await addStaffAction(fd);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Staff added!");
      setShowAdd(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, fd: FormData) {
    setLoading(true);
    const r = await updateStaffAction(id, fd);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this staff member?")) return;
    setDeletingId(id);
    const r = await deleteStaffAction(id);
    setDeletingId(null);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Deleted!");
      router.refresh();
    }
  }

  async function exportExcel() {
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Staff");

      // Build headers
      const headers = [
        "Branch",
        "Name",
        "Category",
        "Salary",
        "Contact",
        "Address",
        "Join Date",
        "Active",
      ];
      sheet.addRow(headers);

      // Style header row
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF27272A" }, // zinc-800
      };
      headerRow.alignment = { vertical: "middle", horizontal: "left" };

      // Add data rows
      initialStaff.forEach((s) => {
        sheet.addRow([
          s.branchName || "",
          s.name,
          s.category,
          `₹${s.salary.toLocaleString("en-IN")}`,
          s.contactNumber,
          s.address || "",
          s.joinDate,
          s.isActive ? "Yes" : "No",
        ]);
      });

      // Auto-width columns
      sheet.columns.forEach((col) => {
        col.width = 20;
      });

      // Generate blob and trigger download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "BrothersGym_Staff.xlsx";
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Excel downloaded!");
    } catch (err) {
      console.error("Excel export error:", err);
      toast.error("Failed to export Excel");
    }
  }

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "Trainer", label: "Trainers" },
    { key: "Worker", label: "Workers" },
    { key: "Cleaner", label: "Cleaners" },
    { key: "inactive", label: "Inactive" },
  ];

  return (
    <div className="adm-pagebody">
      {/* Payroll is the number this page exists to control. */}
      <section className="adm-hero">
        <div className="adm-hero-label">Monthly Payroll · Active Staff</div>
        <div className="adm-hero-value" style={{ color: "var(--blue2)" }}>
          {formatINR(payroll)}
        </div>
        <div className="adm-hero-meta">
          <div>
            <div className="adm-hero-meta-k">Trainers</div>
            <div className="adm-hero-meta-v">{counts.Trainer}</div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Workers</div>
            <div className="adm-hero-meta-v">{counts.Worker}</div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Cleaners</div>
            <div className="adm-hero-meta-v">{counts.Cleaner}</div>
          </div>
        </div>
      </section>

      <div className="adm-search" style={{ marginTop: 14 }}>
        <Search size={16} />
        <input
          type="search"
          inputMode="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, role…"
          aria-label="Search staff"
        />
      </div>

      <div className="adm-chips" role="tablist" aria-label="Filter staff">
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

      <div className="adm-toolbar">
        {/* Desktop's stand-in for the FAB, on the same row as the export so
            the page's actions are all in one place. display:none on a phone. */}
        {canEdit && (
          <button
            type="button"
            className="adm-btn primary adm-desk-only"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={16} /> Add Staff
          </button>
        )}
        <button onClick={exportExcel} className="adm-btn" type="button">
          <FileSpreadsheet size={15} /> Excel
        </button>
        <span className="adm-toolbar-count">{filtered.length} shown</span>
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <Briefcase size={22} />
          </div>
          <p className="adm-empty-title">No staff found</p>
          <p className="adm-empty-text">
            {search || filter !== "all"
              ? "Try a different search or filter."
              : "Add your first staff member with the + button."}
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {filtered.map((s) => (
          <article
            key={s.id}
            className="adm-rec"
            style={s.isActive ? undefined : { opacity: 0.62 }}
          >
            <div className="adm-rec-top">
              <div className="adm-rec-ava">{s.name.charAt(0)}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="adm-rec-name">{s.name}</div>
                <div className="adm-rec-tags">
                  <span className="adm-tag info">{s.category}</span>
                  {s.isActive ? (
                    <span className="adm-tag ok">Active</span>
                  ) : (
                    <span className="adm-tag muted">Inactive</span>
                  )}
                  {showBranchColumn && s.branchCode && (
                    <span className="adm-tag gold">{s.branchCode}</span>
                  )}
                </div>
              </div>

              <div className="adm-rec-amt" style={{ color: "var(--blue2)" }}>
                {formatINR(s.salary)}
                <span
                  style={{
                    display: "block",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "var(--text3)",
                    textAlign: "right",
                  }}
                >
                  /month
                </span>
              </div>
            </div>

            <div className="adm-rec-grid">
              <div>
                <div className="adm-rec-k">Contact</div>
                <a href={`tel:${s.contactNumber}`} className="adm-rec-v adm-link">
                  <Phone size={11} /> {s.contactNumber}
                </a>
              </div>
              <div>
                <div className="adm-rec-k">Joined</div>
                <div className="adm-rec-v">{s.joinDate}</div>
              </div>
              {s.address && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="adm-rec-k">Address</div>
                  <div className="adm-rec-v">{s.address}</div>
                </div>
              )}
            </div>

            {canEdit && (
              <div className="adm-rec-foot">
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="adm-act gold"
                  aria-label={`Edit ${s.name}`}
                >
                  <Edit size={15} />
                  <span className="adm-act-label">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  className="adm-act icon red"
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </article>
        ))}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          className="adm-fab"
          onClick={() => setShowAdd(true)}
          aria-label="Add staff"
        >
          <Plus size={18} /> Staff
        </button>
      )}

      {showAdd && canEdit && (
        <Sheet onClose={() => setShowAdd(false)} title="Add Staff Member">
          <StaffForm
            onSubmit={handleAdd}
            loading={loading}
            onCancel={() => setShowAdd(false)}
            needsBranchPick={needsBranchPick}
            branches={branches}
            today={today}
            submitLabel="Save Staff"
          />
        </Sheet>
      )}

      {editing && canEdit && (
        <Sheet onClose={() => setEditing(null)} title="Edit Staff">
          <StaffForm
            onSubmit={(fd) => handleUpdate(editing.id, fd)}
            loading={loading}
            onCancel={() => setEditing(null)}
            branches={branches}
            today={today}
            staff={editing}
            submitLabel="Update"
          />
        </Sheet>
      )}
    </div>
  );
}

/** One form for add and edit — the fields are identical apart from the branch
 *  picker, which only appears when no branch is selected. */
function StaffForm({
  onSubmit,
  onCancel,
  loading,
  staff,
  needsBranchPick = false,
  branches,
  today,
  submitLabel,
}: {
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  staff?: Staff;
  needsBranchPick?: boolean;
  branches: Branch[];
  today: string;
  submitLabel: string;
}) {
  const idFor = (n: string) => `sf-${n}`;

  return (
    <form action={onSubmit}>
      {needsBranchPick && (
        <div className="adm-field">
          <label className="adm-label" htmlFor={idFor("branch")}>
            Branch *
          </label>
          <select
            id={idFor("branch")}
            name="branchId"
            required
            className="adm-select"
          >
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
        <div className="adm-field span2">
          <label className="adm-label" htmlFor={idFor("name")}>
            Full Name *
          </label>
          <input
            id={idFor("name")}
            name="name"
            required
            defaultValue={staff?.name}
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor={idFor("category")}>
            Category *
          </label>
          <select
            id={idFor("category")}
            name="category"
            defaultValue={staff?.category || "Trainer"}
            required
            className="adm-select"
          >
            <option value="Trainer">Trainer</option>
            <option value="Worker">Worker</option>
            <option value="Cleaner">Cleaner</option>
          </select>
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor={idFor("salary")}>
            Monthly Salary (₹) *
          </label>
          <input
            id={idFor("salary")}
            name="salary"
            type="number"
            required
            defaultValue={staff?.salary}
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor={idFor("contact")}>
            Contact Number *
          </label>
          <input
            id={idFor("contact")}
            name="contactNumber"
            type="tel"
            required
            defaultValue={staff?.contactNumber}
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor={idFor("join")}>
            Join Date *
          </label>
          <input
            id={idFor("join")}
            name="joinDate"
            type="date"
            defaultValue={staff?.joinDate || today}
            required
            className="adm-input"
          />
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor={idFor("address")}>
            Address (optional)
          </label>
          <textarea
            id={idFor("address")}
            name="address"
            rows={2}
            defaultValue={staff?.address || ""}
            className="adm-textarea"
          />
        </div>
      </div>

      <label className="adm-switch">
        <span className="adm-switch-text">
          <span className="adm-switch-title">Currently active</span>
          <span className="adm-switch-sub">
            Inactive staff are excluded from the payroll total
          </span>
        </span>
        {/* The real checkbox stays in the form (the action reads `isActive`);
            the span next to it is what gets painted as a switch. Styling the
            input itself with ::after is not reliable in Firefox. */}
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={staff ? staff.isActive : true}
        />
        <span className="adm-switch-track" aria-hidden="true" />
      </label>

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onCancel} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          {loading ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
