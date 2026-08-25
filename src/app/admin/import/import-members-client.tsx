"use client";

import { useState } from "react";
import ExcelJS from "exceljs";
import toast from "react-hot-toast";
import { importMembersAction, ImportMemberRow } from "@/app/actions/import-members";
import { Upload, FileCheck, AlertCircle, Building2, Info } from "lucide-react";

function excelDateToISO(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "number") {
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    return utc.toISOString().split("T")[0];
  }
  const d = new Date(String(value));
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return String(value);
}

function toInt(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : Math.floor(n);
}

function cellValue(cell: ExcelJS.Cell): unknown {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (typeof v === "object" && v !== null && "result" in v) {
    return (v as { result: unknown }).result;
  }
  if (typeof v === "object" && v !== null && "richText" in v) {
    return (v as { richText: { text: string }[] }).richText
      .map((t) => t.text)
      .join("");
  }
  return v;
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes ("")
// and both \n and \r\n line endings. Returns a 2D array of raw string cells.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore — handled by the \n that follows (or trailing CR)
    } else {
      field += c;
    }
  }

  // Flush the final field/row if the file doesn't end with a newline
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type Branch = { id: number; code: string; name: string };

type Props = {
  branches: Branch[];
  currentBranchId: number | null;
  canUse?: boolean;
};

export default function ImportMembersClient({
  branches,
  currentBranchId,
  canUse = true,
}: Props) {
  const [rows, setRows] = useState<ImportMemberRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<number | "">(
    currentBranchId || ""
  );

  const needsBranchPick = currentBranchId === null;

  async function onFile(file: File) {
    setFileName(file.name);

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum 5 MB allowed.");
      return;
    }

    const allowedExtensions = [".xlsx", ".xls", ".csv"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedExtensions.includes(ext)) {
      toast.error("Only .xlsx, .xls, or .csv files allowed.");
      return;
    }

    try {
      // Build a common grid (rows of raw cell values) from either format so the
      // column-matching + row-mapping logic below runs identically for both.
      // grid[0] is the header row; cell indexes are 1-based to match ExcelJS.
      let grid: unknown[][];

      if (ext === ".csv") {
        const text = await file.text();
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          toast.error("CSV file is empty.");
          return;
        }
        // Shift each row by one so index 1 = first column (ExcelJS convention)
        grid = parsed.map((r) => ["", ...r]);
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          toast.error("Excel file has no sheets.");
          return;
        }

        grid = [];
        worksheet.eachRow((row, rowNum) => {
          const cells: unknown[] = [];
          row.eachCell((cell, colNum) => {
            cells[colNum] = cellValue(cell);
          });
          grid[rowNum] = cells;
        });
        // Drop the empty index-0 slot created by 1-based rowNum
        grid = grid.filter((r) => r !== undefined);
      }

      // Get header row
      const headers: string[] = [];
      const headerCells = grid[0] || [];
      headerCells.forEach((cell, colNum) => {
        headers[colNum] = String(cell ?? "").trim();
      });

      // Smart column matcher — accepts multiple naming conventions
      const colIndex = (names: string[]): number => {
        for (const name of names) {
          const idx = headers.findIndex(
            (h) => h && h.toLowerCase().replace(/[\s.]/g, "") === name.toLowerCase().replace(/[\s.]/g, "")
          );
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const cols = {
        // Owner's format uses "M.No" — also accept "Gym ID", "GymId"
        gymId: colIndex(["M.No", "MNo", "Gym ID", "GymId", "gymId"]),
        // "Fees" or "Fee Amount"
        feeAmount: colIndex(["Fees", "Fee Amount", "Fee", "feeAmount"]),
        name: colIndex(["Name", "name"]),
        address: colIndex(["Address", "address"]),
        // "Father Name" (new) or "Parent Name" (old)
        parentName: colIndex(["Father Name", "FatherName", "Parent Name", "ParentName", "parentName"]),
        // "Ph.No" (new) or "Contact Number" (old)
        contactNumber: colIndex(["Ph.No", "PhNo", "Contact Number", "Contact", "Phone", "contactNumber"]),
        joiningDate: colIndex(["Joining Date", "JoiningDate", "joiningDate"]),
        // "Due Date" (new) or "Membership Expiry" (old)
        membershipExpiry: colIndex(["Due Date", "DueDate", "Membership Expiry", "Expiry Date", "membershipExpiry"]),
        // Optional
        email: colIndex(["Email", "Gmail", "email"]),
        emergencyContact: colIndex(["Emergency Contact", "emergencyContact"]),
      };

      const mapped: ImportMemberRow[] = [];

      // Skip grid[0] (header); map every subsequent row through the same logic.
      grid.slice(1).forEach((cells) => {
        const get = (idx: number) => (idx > 0 ? cells[idx] ?? "" : "");

        const contact = String(get(cols.contactNumber) || "").trim();

        mapped.push({
          gymId: toInt(get(cols.gymId)),
          name: String(get(cols.name) || "").trim(),
          email: (String(get(cols.email) || "").trim() || null) as string | null,
          contactNumber: contact,
          address: (String(get(cols.address) || "").trim() || null) as string | null,
          parentName: (String(get(cols.parentName) || "").trim() || null) as string | null,
          emergencyContact:
            String(get(cols.emergencyContact) || "").trim() || contact || "N/A",
          feeAmount: toInt(get(cols.feeAmount)),
          joiningDate: excelDateToISO(get(cols.joiningDate)),
          membershipExpiry: excelDateToISO(get(cols.membershipExpiry)),
        });
      });

      const valid = mapped.filter(
        (x) => x.name && x.gymId > 0 && x.contactNumber
      );
      setRows(valid);
      setSkippedCount(mapped.length - valid.length);

      if (valid.length === 0) {
        toast.error("No valid rows found. Check your column headers.");
      } else {
        toast.success(`Loaded ${valid.length} rows`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to read file";
      toast.error("Failed to read file: " + msg);
    }
  }

  async function handleImport() {
    if (!rows.length) {
      toast.error("No rows loaded");
      return;
    }
    if (needsBranchPick && !selectedBranchId) {
      toast.error("Please select a branch to import into");
      return;
    }

    const branchIdToUse = selectedBranchId ? Number(selectedBranchId) : undefined;

    if (
      !confirm(
        `Import ${rows.length} members into ${
          branches.find((b) => b.id === branchIdToUse)?.name || "your branch"
        }?`
      )
    )
      return;

    setLoading(true);
    const result = await importMembersAction(rows, branchIdToUse);
    setLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success(`Imported ${result.success} members to ${result.branchName}`);
    if (result.errors?.length) {
      console.warn("Import errors:", result.errors);
      toast.error(`${result.errors.length} rows failed (check console)`);
    }

    setRows([]);
    setSkippedCount(0);
    setFileName("");
  }

  return (
    <div>
      {needsBranchPick && (
        <section className="adm-card adm-note" style={{ marginBottom: 12 }}>
          <Building2 size={17} style={{ flex: "0 0 auto", color: "var(--gold)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="adm-note-title">Pick a branch first</p>
            <p className="adm-note-text">
              You are viewing all branches, so the import needs to know where
              these members belong.
            </p>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(Number(e.target.value))}
              className="adm-select"
              style={{ marginTop: 10 }}
              aria-label="Target branch"
            >
              <option value="">-- Choose a branch --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {/* The file picker is the whole point of the page, so it comes first and
          the column reference folds away underneath it. */}
      <label className={`adm-filepick${canUse ? "" : " off"}`}>
        <Upload size={17} />
        {fileName || "Choose Excel or CSV file"}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={!canUse}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      <p className="adm-hint" style={{ textAlign: "center" }}>
        .xlsx, .xls or .csv · up to 5 MB
      </p>

      <details className="adm-fold" style={{ marginTop: 12 }}>
        <summary>
          <Info size={15} style={{ color: "var(--blue2)" }} />
          Which columns are needed?
          <span className="adm-fold-hint">tap to open</span>
        </summary>
        <div className="adm-fold-body">
          <div className="adm-field">
            <div className="adm-label" style={{ color: "var(--gold2)" }}>
              Required
            </div>
            <p className="adm-note-text" style={{ marginTop: 0 }}>
              M.No · Fees · Name · Address · Father Name · Ph.No · Joining Date ·
              Due Date
            </p>
          </div>
          <div className="adm-field">
            <div className="adm-label" style={{ color: "var(--green2)" }}>
              Also accepted
            </div>
            <p className="adm-note-text" style={{ marginTop: 0 }}>
              Gym ID · Fee Amount · Parent Name · Contact Number · Membership
              Expiry
            </p>
          </div>
          <div className="adm-field" style={{ marginBottom: 0 }}>
            <div className="adm-label">Optional</div>
            <p className="adm-note-text" style={{ marginTop: 0 }}>
              Email · Emergency Contact
            </p>
          </div>
          <p className="adm-hint">
            Your existing sheet works as-is — the column names are matched, not
            the order.
          </p>
        </div>
      </details>

      {rows.length > 0 && (
        <section className="adm-card adm-note good" style={{ marginTop: 12 }}>
          <FileCheck size={17} style={{ flex: "0 0 auto", color: "var(--green2)" }} />
          <div>
            <p className="adm-note-title">
              {rows.length} row{rows.length === 1 ? "" : "s"} ready
            </p>
            <p className="adm-note-text">Check the preview below before importing.</p>
          </div>
        </section>
      )}

      {skippedCount > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div>
            <p className="adm-note-title">{skippedCount} skipped</p>
            <p className="adm-note-text">
              These rows had no name, no M.No or no Ph.No, so they cannot be
              imported.
            </p>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <h2 className="adm-h2">Preview</h2>
          {/* A table would need sideways scrolling on a phone, so each row is
              read the same way the members list is. */}
          <section className="adm-card">
            {rows.slice(0, 20).map((r, i) => (
              <div key={i} className="adm-feed-row">
                <div className="adm-feed-icon tone-gold">
                  <FileCheck size={14} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-feed-title">{r.name}</div>
                  <div className="adm-feed-sub">
                    #{r.gymId} · {r.contactNumber} · due {r.membershipExpiry || "—"}
                  </div>
                </div>
                <div className="adm-feed-amt" style={{ color: "var(--green2)" }}>
                  ₹{r.feeAmount}
                </div>
              </div>
            ))}
            {rows.length > 20 && (
              <p className="adm-footnote" style={{ marginBottom: 0 }}>
                +{rows.length - 20} more rows will also be imported
              </p>
            )}
          </section>
        </>
      )}

      <button
        type="button"
        onClick={handleImport}
        disabled={loading || rows.length === 0 || !canUse}
        className="adm-btn primary block"
        style={{ marginTop: 14 }}
      >
        <Upload size={16} />
        {loading
          ? "Importing…"
          : rows.length > 0
            ? `Import ${rows.length} members`
            : "Import members"}
      </button>
    </div>
  );
}