"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { importMembersAction, ImportMemberRow } from "@/app/actions/import-members";
import {
  cellValue,
  parseCSV,
  parseSheets,
  SKIP_LABELS,
  type Mapping,
  type ParsedSheet,
  type SheetReport,
  type SkipReason,
} from "@/lib/import-parse";
import { Upload, FileCheck, AlertCircle, Building2, Info } from "lucide-react";

type Props = {
  branches: { id: number; code: string; name: string }[];
  currentBranchId: number | null;
  canUse?: boolean;
};

/** Rows per server call — bounds the payload and the wall clock. */
const SEND_CHUNK = 400;

export default function ImportMembersClient({
  branches,
  currentBranchId,
  canUse = true,
}: Props) {
  const [rows, setRows] = useState<ImportMemberRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [updateExisting, setUpdateExisting] = useState(false);
  const [skippedNotice, setSkippedNotice] = useState(0);
  const [sheets, setSheets] = useState<SheetReport[]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [skipped, setSkipped] = useState<Record<SkipReason, number> | null>(null);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [withoutPhone, setWithoutPhone] = useState(0);
  const [withoutDueDate, setWithoutDueDate] = useState(0);
  const [unreadableDueDate, setUnreadableDueDate] = useState(0);
  const [datedToday, setDatedToday] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | "">(
    currentBranchId || ""
  );

  const needsBranchPick = currentBranchId === null;
  const cardioCount = rows.filter((r) => r.planType === "full").length;

  async function onFile(file: File) {
    setFileName(file.name);
    setFailures([]);
    setSkippedNotice(0);

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum 5 MB allowed.");
      return;
    }

    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    // exceljs cannot open the old .xls format, so say what to do instead.
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
      // Every sheet is read and mapped on its own header row.
      const parsed: ParsedSheet[] = [];

      if (ext === ".csv") {
        const csv = parseCSV(await file.text());
        if (csv.length === 0) {
          toast.error("CSV file is empty.");
          return;
        }
        // Shift each row by one so index 1 = first column (ExcelJS convention)
        parsed.push({ name: file.name, grid: csv.map((r) => ["", ...r]) });
      } else {
        const buffer = await file.arrayBuffer();
        // Loaded at runtime so exceljs stays out of the bundle until needed.
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
          // Drop the empty index-0 slot created by 1-based rowNum
          parsed.push({
            name: worksheet.name,
            grid: grid.filter((r) => r !== undefined),
          });
        }
      }

      const result = parseSheets(parsed);

      setSheets(result.sheets);
      setMapping(result.mapping);
      setSkipped(result.skipped);
      setDuplicates(result.duplicates);
      setWithoutPhone(result.withoutPhone);
      setWithoutDueDate(result.withoutDueDate);
      setUnreadableDueDate(result.unreadableDueDate);
      setDatedToday(result.datedToday);
      setRows(result.rows);

      if (result.rows.length === 0) {
        toast.error("No valid rows found. Check the columns report below.");
      } else {
        toast.success(`Loaded ${result.rows.length} rows`);
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
        }?${
          updateExisting
            ? "\n\nMembers already in the system WILL be overwritten."
            : "\n\nMembers already in the system will be SKIPPED — nothing in this file is read for them. To refresh them from this sheet, turn on \"Update existing members\" first."
        }`
      )
    )
      return;

    setLoading(true);
    setFailures([]);
    setSkippedNotice(0);

    let written = 0;
    let skippedExisting = 0;
    const errors: string[] = [];

    try {
      // Chunked so no single call runs past the function's wall-clock budget.
      for (let i = 0; i < rows.length; i += SEND_CHUNK) {
        const chunk = rows.slice(i, i + SEND_CHUNK);
        setProgress({ done: i, total: rows.length });

        const result = await importMembersAction(
          chunk,
          branchIdToUse,
          updateExisting
        );

        if ("error" in result) {
          toast.error(result.error);
          return;
        }

        written += result.written;
        skippedExisting += result.skippedExisting;
        errors.push(...result.errors);
        setProgress({
          done: Math.min(i + chunk.length, rows.length),
          total: rows.length,
        });
      }

      if (written === 0 && skippedExisting === 0) {
        toast.error("Nothing was imported — every row was rejected.");
      } else if (updateExisting) {
        toast.success(`Imported ${written} members, updating any that existed`);
      } else {
        toast.success(
          `Imported ${written} members` +
            (skippedExisting ? ` · ${skippedExisting} already existed` : "")
        );
      }

      if (errors.length) {
        setFailures(errors);
        toast.error(`${errors.length} rows could not be imported`);
      } else if (skippedExisting > 0 && !updateExisting) {
        // The sheet is deliberately left loaded. This run changed nothing at all
        // about those rows — the fee, the due date, the plan and the Sex column
        // in the file were all ignored for them — and the one useful next step
        // needs the file still in memory: switch the toggle on, press Import
        // again. Clearing it here is what turned a silent no-op into a dead end.
        setSkippedNotice(skippedExisting);
      } else {
        // Cleared only on a wholly clean run, so a partial import stays on screen.
        setRows([]);
        setSheets([]);
        setMapping(null);
        setSkipped(null);
        setDuplicates([]);
        setWithoutPhone(0);
        setWithoutDueDate(0);
        setDatedToday([]);
        setFileName("");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      // Everything written before the failure is committed, so say how far it got.
      toast.error(
        `${msg}${written ? ` — ${written} members were imported first` : ""}`
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const skippedTotal = skipped
    ? Object.values(skipped).reduce((a, b) => a + b, 0)
    : 0;
  const duplicateTotal = duplicates.length;

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

      {/* The picker is the point of the page, so it comes first. */}
      <label className={`adm-filepick${canUse ? "" : " off"}`}>
        <Upload size={17} />
        {fileName || "Choose Excel or CSV file"}
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={!canUse}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      <p className="adm-hint" style={{ textAlign: "center" }}>
        .xlsx or .csv · up to 5 MB · every sheet in the workbook is read
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
              M.No · Fees · Name
            </p>
          </div>
          <div className="adm-field">
            <div className="adm-label" style={{ color: "var(--green2)" }}>
              Optional
            </div>
            <p className="adm-note-text" style={{ marginTop: 0 }}>
              Phone · Sex · Due Date · Address · Father Name · Joining Date ·
              Email · Emergency Contact
            </p>
          </div>
          <p className="adm-hint">
            A row with no phone or no due date is still imported, and counted
            below so you know which ones to fill in. Blank due dates are dated
            today.
          </p>
          <p className="adm-hint">
            Column names are matched, not the order — including spellings like
            &ldquo;Mobile No&rdquo;, &ldquo;S/O&rdquo;, &ldquo;Valid Upto&rdquo; or
            &ldquo;Amount&rdquo;. Any other column is ignored, and the report below
            names every column it matched and every one it left out.
          </p>
          <p className="adm-hint" style={{ marginBottom: 0 }}>
            A <strong>C</strong> on the M.No (C123) means that member is marked
            Cardio; everyone else is Hardcore. The split is shown before you
            import.
          </p>
          <p className="adm-hint" style={{ marginBottom: 0 }}>
            A <strong>Sex</strong> column is read as it is written — M, Male, F,
            Female, Woman — and a <strong>Cardio/Hardcore</strong> column is read
            as the plan. Both are optional. On a member already on file, Sex
            fills a blank and never overwrites what is there; the plan, like the
            fee and the due date, is overwritten.
          </p>
        </div>
      </details>

      {/* ===== COLUMN REPORT ===== */}
      {mapping && (
        <section className="adm-card" style={{ marginTop: 12 }}>
          <p className="adm-note-title" style={{ marginTop: 0 }}>
            Columns found
          </p>
          <p className="adm-note-text">
            {mapping.matched.map((m) => `${m.label} ← ${m.header}`).join(" · ")}
          </p>
          {mapping.ignored.length > 0 && (
            <p className="adm-hint">
              Ignored (not needed): {mapping.ignored.join(", ")}
            </p>
          )}
          {mapping.warnMissing.length > 0 && (
            <p className="adm-hint" style={{ color: "var(--orange)" }}>
              No {mapping.warnMissing.join(" or ")} column — every member will be
              dated today.
            </p>
          )}
        </section>
      )}

      {mapping && mapping.missing.length > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div>
            <p className="adm-note-title">
              Missing required column: {mapping.missing.join(", ")}
            </p>
            <p className="adm-note-text">
              Nothing can be imported without {mapping.missing.join(", ")}. Rename
              the column in your sheet, or tell me the heading you use and I will
              add it.
            </p>
          </div>
        </section>
      )}

      {sheets.length > 1 && (
        <section className="adm-card" style={{ marginTop: 12 }}>
          <p className="adm-note-title" style={{ marginTop: 0 }}>
            Sheets in this workbook
          </p>
          {sheets.map((s) => (
            <p key={s.name} className="adm-note-text" style={{ marginTop: 4 }}>
              <strong>{s.name}</strong> —{" "}
              {s.skipped ? `skipped (${s.skipped})` : `${s.rows} rows`}
            </p>
          ))}
        </section>
      )}

      {rows.length > 0 && (
        <section className="adm-card adm-note good" style={{ marginTop: 12 }}>
          <FileCheck size={17} style={{ flex: "0 0 auto", color: "var(--green2)" }} />
          <div>
            <p className="adm-note-title">
              {rows.length} row{rows.length === 1 ? "" : "s"} ready
            </p>
            <p className="adm-note-text">
              {cardioCount} Cardio · {rows.length - cardioCount} Hardcore. Check the
              preview before importing.
            </p>
          </div>
        </section>
      )}

      {skippedNotice > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div style={{ minWidth: 0 }}>
            <p className="adm-note-title">
              {skippedNotice} member{skippedNotice === 1 ? "" : "s"} already on file
              — left exactly as they were
            </p>
            <p className="adm-note-text">
              That M.No is already in this branch, so this file was not read for
              them at all: not the fee, not the due date, not the plan and not the
              Sex column. That is what importing only new members means.
            </p>
            <p className="adm-hint" style={{ marginBottom: 0 }}>
              If you have corrected the sheet and want it applied to them, turn on
              &ldquo;Update existing members&rdquo; below and press Import again —
              the file is still loaded.
            </p>
          </div>
        </section>
      )}

      {skippedTotal > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div>
            <p className="adm-note-title">{skippedTotal} skipped</p>
            <p className="adm-note-text">
              {skipped &&
                (Object.keys(SKIP_LABELS) as SkipReason[])
                  .filter((k) => skipped[k] > 0)
                  .map((k) => `${skipped[k]} with ${SKIP_LABELS[k]}`)
                  .join(" · ")}
            </p>
            <p className="adm-hint" style={{ marginBottom: 0 }}>
              These rows cannot be imported. Fix them in the sheet and choose the
              file again.
            </p>
          </div>
        </section>
      )}

      {duplicateTotal > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div>
            <p className="adm-note-title">{duplicateTotal} repeated M.No</p>
            <p className="adm-note-text">
              {duplicates.join(" · ")}
              {duplicateTotal > duplicates.length &&
                ` …and ${duplicateTotal - duplicates.length} more`}
            </p>
            <p className="adm-hint" style={{ marginBottom: 0 }}>
              The same M.No appears more than once, so only the first was kept.
              Two different members would otherwise be merged into one.
            </p>
          </div>
        </section>
      )}

      {withoutPhone > 0 && (
        <section className="adm-card adm-note" style={{ marginTop: 12 }}>
          <Info size={17} style={{ flex: "0 0 auto", color: "var(--blue2)" }} />
          <div>
            <p className="adm-note-title">
              {withoutPhone} with no phone number
            </p>
            <p className="adm-note-text">
              They will still be imported. You just can&apos;t WhatsApp or call
              them until a number is added.
            </p>
          </div>
        </section>
      )}

      {withoutDueDate > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div style={{ minWidth: 0 }}>
            <p className="adm-note-title">
              {withoutDueDate} with no due date — dated today
            </p>
            {unreadableDueDate > 0 && (
              <p className="adm-note-text">
                {unreadableDueDate} of them have something in the cell that could
                not be read as a date. The raw text is quoted below, so the
                format can be checked before anything is stored.
              </p>
            )}
            <p className="adm-note-text" style={{ wordBreak: "break-word" }}>
              {datedToday.join(" · ")}
              {withoutDueDate > datedToday.length &&
                ` …and ${withoutDueDate - datedToday.length} more`}
            </p>
            <p className="adm-hint" style={{ marginBottom: 0 }}>
              These will show as expiring today, so they will sit at the top of
              the reminders list until their real date is filled in.
            </p>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <h2 className="adm-h2">Preview</h2>
          {/* Cards, not a table — a table would scroll sideways on a phone. */}
          <section className="adm-card">
            {rows.slice(0, 20).map((r, i) => (
              <div key={i} className="adm-feed-row">
                <div className="adm-feed-icon tone-gold">
                  <FileCheck size={14} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-feed-title">{r.name}</div>
                  <div className="adm-feed-sub">
                    {r.planType === "full" ? "C" : ""}
                    {r.gymId} · {r.contactNumber} · due {r.membershipExpiry || "—"}
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

          <label className="adm-switch" style={{ marginTop: 12 }}>
            <span className="adm-switch-text">
              <span className="adm-switch-title">Update existing members</span>
              <span className="adm-switch-sub">
                Overwrites the fee, due date and plan of any member whose M.No is
                already in this branch. Sex fills a blank, and never overwrites.
                Leave off to add only new members — and to leave every existing
                one, and everything in this file about them, untouched.
              </span>
            </span>
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
            />
            <span className="adm-switch-track" aria-hidden="true" />
          </label>
        </>
      )}

      {failures.length > 0 && (
        <section className="adm-card adm-note danger" style={{ marginTop: 12 }}>
          <AlertCircle size={17} style={{ flex: "0 0 auto", color: "var(--red2)" }} />
          <div style={{ minWidth: 0 }}>
            <p className="adm-note-title">
              {failures.length} row{failures.length === 1 ? "" : "s"} not imported
            </p>
            <p className="adm-note-text" style={{ wordBreak: "break-word" }}>
              {failures.slice(0, 10).map((f, i) => (
                <span key={i}>
                  {f}
                  <br />
                </span>
              ))}
            </p>
            {failures.length > 10 && (
              <p className="adm-hint" style={{ marginBottom: 0 }}>
                …and {failures.length - 10} more.
              </p>
            )}
          </div>
        </section>
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
          ? progress
            ? `Importing ${progress.done} / ${progress.total}…`
            : "Importing…"
          : rows.length > 0
            ? `Import ${rows.length} members`
            : "Import members"}
      </button>
    </div>
  );
}
