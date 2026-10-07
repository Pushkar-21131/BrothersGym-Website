"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { importEnquiriesAction } from "@/app/actions/enquiries";
import { cellValue, parseCSV } from "@/lib/import-parse";
import {
  parseEnquirySheets,
  type EnquiryParseResult,
  type EnquiryParsedSheet,
  type ImportEnquiryRow,
} from "@/lib/enquiry-parse";
import { Sheet } from "../sheet";
import { Upload } from "lucide-react";

type Branch = { id: number; code: string; name: string };

type Props = {
  branches: Branch[];
  currentBranchId: number | null;
  onClose: () => void;
};

/** Rows per server call — bounds the payload and the wall clock. */
const SEND_CHUNK = 400;

/**
 * Loads the owner's existing paper pages in one go.
 *
 * Kept as a sheet on the enquiries page rather than a section of its own,
 * because it shares the whole page's state: a successful import has to land in
 * the list behind it.
 */
export default function EnquiryImportSheet({
  branches,
  currentBranchId,
  onClose,
}: Props) {
  const [rows, setRows] = useState<ImportEnquiryRow[]>([]);
  const [report, setReport] = useState<EnquiryParseResult | null>(null);
  const [fileName, setFileName] = useState("");
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

    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (ext === ".xls") {
      toast.error(
        "Old .xls format is not supported — open it in Excel and Save As .xlsx or .csv."
      );
      return;
    }
    if (![".xlsx", ".csv"].includes(ext)) {
      toast.error("Only .xlsx or .csv files allowed.");
      return;
    }

    try {
      const parsed: EnquiryParsedSheet[] = [];

      if (ext === ".csv") {
        const csv = parseCSV(await file.text());
        if (csv.length === 0) {
          toast.error("CSV file is empty.");
          return;
        }
        // Shifted by one so index 1 is the first column, matching ExcelJS.
        parsed.push({ name: file.name, grid: csv.map((r) => ["", ...r]) });
      } else {
        const buffer = await file.arrayBuffer();
        // Loaded on demand so exceljs stays out of the page bundle.
        const { default: ExcelJSRuntime } = await import("exceljs");
        const workbook = new ExcelJSRuntime.Workbook();
        await workbook.xlsx.load(buffer);

        if (workbook.worksheets.length === 0) {
          toast.error("Excel file has no sheets.");
          return;
        }

        for (const worksheet of workbook.worksheets) {
          const grid: unknown[][] = [];
          worksheet.eachRow((row, rowNum) => {
            const cells: unknown[] = [];
            row.eachCell((cell, colNum) => {
              cells[colNum] = cellValue(cell);
            });
            grid[rowNum] = cells;
          });
          parsed.push({
            name: worksheet.name,
            grid: grid.filter((r) => r !== undefined),
          });
        }
      }

      const result = parseEnquirySheets(parsed);
      setReport(result);
      setRows(result.rows);

      if (result.rows.length === 0) {
        toast.error("No usable rows found — check the columns below.");
      } else {
        toast.success(`Loaded ${result.rows.length} enquiries`);
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
    const branchName =
      branches.find((b) => b.id === branchIdToUse)?.name || "your branch";

    if (!confirm(`Import ${rows.length} enquiries into ${branchName}?`)) return;

    setLoading(true);
    let written = 0;
    let skipped = 0;
    let failed = 0;
    const failedRows: string[] = [];

    try {
      for (let i = 0; i < rows.length; i += SEND_CHUNK) {
        const chunk = rows.slice(i, i + SEND_CHUNK);
        const result = await importEnquiriesAction(chunk, branchIdToUse);

        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        written += result.written;
        skipped += result.skippedExisting;
        failed += result.failed;
        failedRows.push(...result.failedRows);
      }

      // Named rather than counted: this list came off paper, and a row that did
      // not go in is one the owner would otherwise never know was missing.
      if (failedRows.length > 0) {
        toast.error(
          `${failed} could not be imported — ${failedRows.join("; ")}`,
          { duration: 10000 }
        );
      }

      if (written === 0) {
        toast.error(
          failed > 0
            ? "Nothing imported — see the message above."
            : "Nothing imported — these are already on the list."
        );
      } else {
        toast.success(
          `Imported ${written} enquiries` +
            (skipped ? ` · ${skipped} already on the list` : "") +
            (failed ? ` · ${failed} could not be read` : "")
        );
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(`${msg}${written ? ` — ${written} were imported first` : ""}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet onClose={onClose} title="Import Enquiries">
      <p className="adm-hint" style={{ marginBottom: 12 }}>
        Your sheet needs a <strong>Name</strong> column at minimum. Phone, Sex,
        Date of Inquiry and Note are picked up when present.
      </p>

      {needsBranchPick && (
        <div className="adm-field">
          <label className="adm-label" htmlFor="eqi-branch">
            Branch *
          </label>
          <select
            id="eqi-branch"
            value={selectedBranchId}
            onChange={(e) =>
              setSelectedBranchId(e.target.value ? Number(e.target.value) : "")
            }
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

      <div className="adm-field">
        <label className="adm-label" htmlFor="eqi-file">
          File (.xlsx or .csv)
        </label>
        <input
          id="eqi-file"
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="adm-input"
        />
        {fileName && <p className="adm-hint">{fileName}</p>}
      </div>

      {report && report.mapping && (
        <section className="adm-card">
          <p className="adm-hint">
            Columns read:{" "}
            <strong style={{ color: "var(--text)" }}>
              {report.mapping.matched.map((m) => m.header).join(", ") || "none"}
            </strong>
          </p>
          {report.mapping.ignored.length > 0 && (
            <p className="adm-hint">
              Ignored: {report.mapping.ignored.join(", ")}
            </p>
          )}
          <p className="adm-hint">
            {rows.length} ready
            {report.withoutPhone > 0 && ` · ${report.withoutPhone} with no phone`}
            {report.skippedNoName > 0 && ` · ${report.skippedNoName} with no name`}
            {report.duplicates.length > 0 &&
              ` · ${report.duplicates.length} repeated in the file`}
          </p>
          {report.duplicates.length > 0 && (
            <p className="adm-hint">
              Repeated (kept the first): {report.duplicates.join(", ")}
            </p>
          )}
          {report.sheets.some((s) => s.skipped) && (
            <p className="adm-hint">
              Skipped sheets:{" "}
              {report.sheets
                .filter((s) => s.skipped)
                .map((s) => `${s.name} (${s.skipped})`)
                .join(", ")}
            </p>
          )}
        </section>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={loading || rows.length === 0}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          <Upload size={15} />
          {loading ? "Importing…" : `Import ${rows.length || ""}`}
        </button>
      </div>
    </Sheet>
  );
}
