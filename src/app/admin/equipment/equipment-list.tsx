"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Plus,
  Download,
  FileSpreadsheet,
  Edit,
  Trash2,
  Wrench,
  Search,
} from "lucide-react";
import {
  addEquipmentAction,
  updateEquipmentAction,
  deleteEquipmentAction,
} from "@/app/actions/equipment";
import { formatINR, istDateString } from "@/lib/utils";
import { Sheet } from "../sheet";

/** One row as `admin/equipment/page.tsx` selects it. Exported so that page can
 *  annotate its query instead of casting the prop to `any`. */
export type Item = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  equipmentName: string;
  cost: number;
  date: string;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialItems: Item[];
  showBranchColumn: boolean;
  branches: Branch[];
  currentBranchId: number | null;
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

export default function EquipmentList({
  initialItems,
  showBranchColumn,
  branches,
  currentBranchId,
  canAdd = true,
  canEdit = true,
  canDelete = true,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();

  const needsBranchPick = currentBranchId === null;
  const today = istDateString();

  const totals = useMemo(() => {
    const all = initialItems.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
    // "This year" resets in January, which is how the owner thinks about
    // spending — not a rolling 365 days.
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const thisYear = initialItems
      .filter((i) => i.date >= yearStart)
      .reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
    return { all, thisYear, count: initialItems.length };
  }, [initialItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return initialItems;
    return initialItems.filter(
      (i) =>
        i.equipmentName.toLowerCase().includes(q) ||
        i.date.includes(q) ||
        (i.branchName && i.branchName.toLowerCase().includes(q))
    );
  }, [initialItems, search]);

  async function handleAdd(formData: FormData) {
    setLoading(true);
    const r = await addEquipmentAction(formData);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Equipment added!");
      setShowAdd(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, formData: FormData) {
    setLoading(true);
    const r = await updateEquipmentAction(id, formData);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this equipment entry?")) return;
    setDeletingId(id);
    const r = await deleteEquipmentAction(id);
    setDeletingId(null);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Deleted!");
      router.refresh();
    }
  }

  async function exportExcel() {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Equipment");

    sheet.addRow(["Branch", "Item", "Cost", "Date"]);
    sheet.getRow(1).font = { bold: true };

    initialItems.forEach((i) => {
      sheet.addRow([
        i.branchName || "",
        i.equipmentName,
        `₹${i.cost.toLocaleString("en-IN")}`,
        i.date,
      ]);
    });

    sheet.columns.forEach((col) => (col.width = 20));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "BrothersGym_Equipment.xlsx";
    link.click();
    URL.revokeObjectURL(url);

    toast.success("Excel downloaded!");
  }

  async function exportPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.text("Brothers Gym - Equipment", 14, 15);
    autoTable(doc, {
      head: [["Branch", "Item", "Date", "Cost"]],
      body: initialItems.map((i) => [
        i.branchCode || "-",
        i.equipmentName,
        i.date,
        `₹${i.cost.toLocaleString("en-IN")}`,
      ]),
      startY: 20,
    });
    doc.save("BrothersGym_Equipment.pdf");
    toast.success("PDF downloaded!");
  }

  return (
    <div className="adm-pagebody">
      <section className="adm-hero">
        <div className="adm-hero-label">Total Spent · All Time</div>
        <div className="adm-hero-value" style={{ color: "var(--red2)" }}>
          {formatINR(totals.all)}
        </div>
        <div className="adm-hero-meta">
          <div>
            <div className="adm-hero-meta-k">This Year</div>
            <div className="adm-hero-meta-v" style={{ color: "var(--orange)" }}>
              {formatINR(totals.thisYear)}
            </div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Entries</div>
            <div className="adm-hero-meta-v">{totals.count}</div>
          </div>
          <div>
            <div className="adm-hero-meta-k">Avg / Item</div>
            <div className="adm-hero-meta-v">
              {formatINR(
                totals.count ? Math.round(totals.all / totals.count) : 0
              )}
            </div>
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
          placeholder="Search item or date…"
          aria-label="Search equipment"
        />
      </div>

      <div className="adm-toolbar">
        {/* Desktop's stand-in for the FAB, on the same row as the exports so
            the page's actions are all in one place. display:none on a phone. */}
        {canAdd && (
          <button
            type="button"
            className="adm-btn primary adm-desk-only"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={16} /> Log Cost
          </button>
        )}
        <button onClick={exportExcel} className="adm-btn" type="button">
          <FileSpreadsheet size={15} /> Excel
        </button>
        <button onClick={exportPDF} className="adm-btn" type="button">
          <Download size={15} /> PDF
        </button>
        <span className="adm-toolbar-count">{filtered.length} shown</span>
      </div>

      {/* Equipment rows are short — name, date, cost — so they read better as a
          compact feed than as full record cards. */}
      {filtered.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <Wrench size={22} />
          </div>
          <p className="adm-empty-title">Nothing logged</p>
          <p className="adm-empty-text">
            {search
              ? "No entry matches that search."
              : "Log your first purchase or repair with the + button."}
          </p>
        </div>
      ) : (
        <section className="adm-card" style={{ padding: "4px 15px" }}>
          {filtered.map((i) => (
            <div key={i.id} className="adm-feed-row" style={{ alignItems: "center" }}>
              <span className="adm-feed-icon tone-red">
                <Wrench size={15} />
              </span>

              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="adm-feed-title" style={{ display: "block" }}>
                  {i.equipmentName}
                </span>
                <span className="adm-feed-sub" style={{ display: "block" }}>
                  {i.date}
                  {showBranchColumn && i.branchCode && ` · ${i.branchCode}`}
                </span>
              </span>

              <span className="adm-feed-amt" style={{ color: "var(--red2)" }}>
                −{formatINR(i.cost)}
              </span>

              {(canEdit || canDelete) && (
                <span style={{ display: "flex", gap: 5, marginLeft: 8 }}>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(i)}
                      className="adm-act icon"
                      aria-label={`Edit ${i.equipmentName}`}
                    >
                      <Edit size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(i.id)}
                      disabled={deletingId === i.id}
                      className="adm-act icon red"
                      aria-label={`Delete ${i.equipmentName}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {canAdd && (
        <button
          type="button"
          className="adm-fab"
          onClick={() => setShowAdd(true)}
          aria-label="Log equipment cost"
        >
          <Plus size={18} /> Log Cost
        </button>
      )}

      {showAdd && canAdd && (
        <Sheet onClose={() => setShowAdd(false)} title="Log Equipment Cost">
          <EquipmentForm
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
            loading={loading}
            needsBranchPick={needsBranchPick}
            branches={branches}
            today={today}
            submitLabel="Save Equipment"
          />
        </Sheet>
      )}

      {editing && canEdit && (
        <Sheet onClose={() => setEditing(null)} title="Edit Equipment">
          <EquipmentForm
            onSubmit={(fd) => handleUpdate(editing.id, fd)}
            onCancel={() => setEditing(null)}
            loading={loading}
            branches={branches}
            today={today}
            item={editing}
            submitLabel="Update"
          />
        </Sheet>
      )}
    </div>
  );
}

function EquipmentForm({
  onSubmit,
  onCancel,
  loading,
  item,
  needsBranchPick = false,
  branches,
  today,
  submitLabel,
}: {
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  item?: Item;
  needsBranchPick?: boolean;
  branches: Branch[];
  today: string;
  submitLabel: string;
}) {
  return (
    <form action={onSubmit}>
      {needsBranchPick && (
        <div className="adm-field">
          <label className="adm-label" htmlFor="eq-branch">
            Branch *
          </label>
          <select id="eq-branch" name="branchId" required className="adm-select">
            <option value="">-- Select branch --</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="adm-field">
        <label className="adm-label" htmlFor="eq-name">
          Equipment Name *
        </label>
        <input
          id="eq-name"
          name="equipmentName"
          required
          defaultValue={item?.equipmentName}
          placeholder="e.g. Treadmill belt replacement"
          className="adm-input"
        />
      </div>

      <div className="adm-form-grid">
        <div className="adm-field">
          <label className="adm-label" htmlFor="eq-cost">
            Cost (₹) *
          </label>
          <input
            id="eq-cost"
            name="cost"
            type="number"
            required
            defaultValue={item?.cost}
            className="adm-input"
          />
        </div>
        <div className="adm-field">
          <label className="adm-label" htmlFor="eq-date">
            Date *
          </label>
          <input
            id="eq-date"
            name="date"
            type="date"
            defaultValue={item?.date || today}
            required
            className="adm-input"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 9, marginTop: 8 }}>
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
