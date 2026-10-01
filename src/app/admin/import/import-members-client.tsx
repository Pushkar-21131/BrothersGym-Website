"use client";

import { useState } from "react";
import type ExcelJS from "exceljs";
import toast from "react-hot-toast";
import {
  importMembersAction,
  ImportMemberRow,
  MemberPlanType,
} from "@/app/actions/import-members";
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

// ===== THE "C" IN THE M.No COLUMN =====
//
// The owner marks a cardio client by writing a C on the M.No — "C123". That
// letter used to be thrown away by toInt(), and the action then stored every
// imported row as planType "offline", so the only cardio signal in his register
// died on the way in.
//
// Matched on his own convention and nothing wider: a C on either side of the
// number, optionally separated by a dot, dash or slash. Anything that does not
// match falls through to the plain numeric read, so a normal register number can
// never be mistaken for a cardio flag. The preview shows the resulting
// Cardio/Hardcore split before anything is written, which is what catches a
// mis-parse while it is still free.
const CARDIO_PATTERNS = [
  /^c\s*[-./]?\s*(\d+)$/i, // C123, C 123, c.123, C-123, C/123
  /^(\d+)\s*[-./]?\s*c$/i, // 123C, 123 C
  /^(\d+)\s*\(\s*c\s*\)$/i, // 123(C)
];

function parseGymId(raw: unknown): { gymId: number; cardio: boolean } {
  const s = String(raw ?? "").trim();
  if (!s) return { gymId: 0, cardio: false };
  for (const re of CARDIO_PATTERNS) {
    const m = s.match(re);
    if (m) return { gymId: Math.floor(Number(m[1])), cardio: true };
  }
  return { gymId: toInt(s), cardio: false };
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

// ===== COLUMN MATCHING =====
//
// Two passes. The first compares the header against a list of known spellings;
// the second picks up anything still unmatched by a keyword, so a column called
// "Mobile No" or "Valid Upto" is recognised rather than silently dropped. That
// fallback is the point: the owner's sheet is his own, and a column the matcher
// does not recognise is a column of his members' data that never arrives.
//
// Order matters, because a keyword as loose as "name" would otherwise swallow
// "Father Name" and a keyword as loose as "contact" would swallow "Emergency
// Contact". The more specific field is tried first and the header is then marked
// as taken, and the few genuinely ambiguous ones carry an explicit `exclude`.

type FieldKey =
  | "gymId"
  | "name"
  | "parentName"
  | "contactNumber"
  | "emergencyContact"
  | "feeAmount"
  | "joiningDate"
  | "membershipExpiry"
  | "address"
  | "email";

type FieldSpec = {
  key: FieldKey;
  label: string;
  required?: boolean;
  /** Missing this is not fatal, but the import will fill in today's date. */
  warnIfMissing?: boolean;
  aliases: string[];
  keywords: string[];
  exclude?: string[];
};

const FIELDS: FieldSpec[] = [
  {
    key: "gymId",
    label: "M.No",
    required: true,
    aliases: [
      "mno", "mno.", "gymid", "gymno", "memberno", "membershipno", "memberid",
      "regno", "regnno", "token", "tokenno",
    ],
    keywords: ["mno", "gymid", "memberno", "membershipno", "regno"],
  },
  {
    key: "parentName",
    label: "Father Name",
    aliases: [
      "fathername", "parentname", "guardianname", "father", "parent",
      "guardian", "so", "s/o", "husbandname", "mothername",
    ],
    keywords: ["father", "parent", "guardian", "husband", "mother"],
  },
  {
    key: "emergencyContact",
    label: "Emergency Contact",
    aliases: [
      "emergencycontact", "emergencyno", "emergencyphone", "emergency",
      "alternatecontact", "alternateno", "alternatephone",
    ],
    keywords: ["emergency", "alternate"],
  },
  {
    key: "contactNumber",
    label: "Ph.No",
    required: true,
    aliases: [
      "phno", "phoneno", "phone", "contactno", "contactnumber", "contact",
      "mobile", "mobileno", "cellno", "whatsapp", "whatsappno", "ph",
    ],
    keywords: ["phone", "mobile", "contact", "cell", "whatsapp"],
    exclude: ["emergency"],
  },
  {
    key: "membershipExpiry",
    label: "Due Date",
    required: true,
    aliases: [
      "duedate", "duedt", "membershipexpiry", "expirydate", "expiry",
      "validdate", "validupto", "validuptil", "upto", "renewaldate",
      "lastdate", "nextdue",
    ],
    keywords: ["due", "expir", "valid", "renewal", "upto"],
  },
  {
    key: "joiningDate",
    label: "Joining Date",
    warnIfMissing: true,
    aliases: [
      "joiningdate", "joindate", "doj", "dateofjoining", "admissiondate",
      "startdate", "joining",
    ],
    keywords: ["joining", "joindate", "admission", "startdate", "doj"],
  },
  {
    key: "feeAmount",
    label: "Fees",
    required: true,
    aliases: [
      "fees", "fee", "feeamount", "amount", "feespaid", "membershipfees",
      "charges", "paid", "totalfee", "monthlyfee",
    ],
    keywords: ["fee", "amount", "charg", "paid", "price", "rate"],
  },
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["name", "membername", "fullname", "customername", "partyname"],
    keywords: ["name"],
    exclude: ["father", "mother", "parent", "guardian", "gym", "trainer"],
  },
  {
    key: "address",
    label: "Address",
    aliases: [
      "address", "addr", "fulladdress", "residence", "postaladdress",
      "permanentaddress",
    ],
    keywords: ["address", "addr", "resid", "location"],
  },
  {
    key: "email",
    label: "Email",
    aliases: ["email", "gmail", "emailid", "mail", "emailaddress"],
    keywords: ["email", "mail", "gmail"],
  },
];

const REQUIRED_KEYS = FIELDS.filter((f) => f.required).map((f) => f.key);

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

type Mapping = {
  cols: Partial<Record<FieldKey, number>>;
  matched: { label: string; header: string }[];
  ignored: string[];
  missing: string[];
  warnMissing: string[];
};

function matchColumns(headers: string[]): Mapping {
  const normalised = headers.map(norm);
  const taken = new Set<number>();
  const cols: Partial<Record<FieldKey, number>> = {};

  const claimable = (i: number, spec: FieldSpec) =>
    normalised[i] !== "" &&
    !taken.has(i) &&
    !(spec.exclude ?? []).some((x) => normalised[i].includes(x));

  // Pass 1 — a known spelling, exact once punctuation and case are ignored.
  for (const spec of FIELDS) {
    for (const alias of spec.aliases) {
      const want = norm(alias);
      const idx = normalised.findIndex(
        (h, i) => claimable(i, spec) && h === want
      );
      if (idx !== -1) {
        cols[spec.key] = idx;
        taken.add(idx);
        break;
      }
    }
  }

  // Pass 2 — anything still unclaimed, by keyword.
  for (const spec of FIELDS) {
    if (cols[spec.key] !== undefined) continue;
    const idx = normalised.findIndex(
      (h, i) => claimable(i, spec) && spec.keywords.some((k) => h.includes(k))
    );
    if (idx !== -1) {
      cols[spec.key] = idx;
      taken.add(idx);
    }
  }

  const matched: { label: string; header: string }[] = [];
  for (const spec of FIELDS) {
    const idx = cols[spec.key];
    if (idx !== undefined) matched.push({ label: spec.label, header: headers[idx] });
  }

  return {
    cols,
    matched,
    ignored: headers.filter((h, i) => h.trim() !== "" && !taken.has(i)),
    missing: FIELDS.filter((f) => f.required && cols[f.key] === undefined).map(
      (f) => f.label
    ),
    warnMissing: FIELDS.filter(
      (f) => f.warnIfMissing && cols[f.key] === undefined
    ).map((f) => f.label),
  };
}

/**
 * The header is not always the first row — a register often opens with a title
 * like "BROTHERS GYM — MEMBER LIST" above the column names. So the first ten
 * rows are tried in turn and the first one that matches at least three required
 * columns wins. Without this the whole sheet reads as headerless and every row
 * is discarded.
 */
function findHeader(grid: unknown[][]): { index: number; mapping: Mapping } | null {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const headers = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    const mapping = matchColumns(headers);
    const found = REQUIRED_KEYS.filter((k) => mapping.cols[k] !== undefined).length;
    if (found >= 3) return { index: i, mapping };
  }
  return null;
}

type SkipReason = "gymId" | "name" | "contact" | "fee" | "expiry";

const SKIP_LABELS: Record<SkipReason, string> = {
  gymId: "no M.No",
  name: "no name",
  contact: "no phone number",
  fee: "no fee",
  expiry: "no due date",
};

type SheetReport = { name: string; rows: number; skipped?: string };

type Props = {
  branches: { id: number; code: string; name: string }[];
  currentBranchId: number | null;
  canUse?: boolean;
};

/** Rows per server call. Keeps every request small and every call inside the
 *  function's wall-clock budget — see the long note in the action. */
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
  const [sheets, setSheets] = useState<SheetReport[]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [skipped, setSkipped] = useState<Record<SkipReason, number> | null>(null);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | "">(
    currentBranchId || ""
  );

  const needsBranchPick = currentBranchId === null;
  const cardioCount = rows.filter((r) => r.planType === "full").length;

  async function onFile(file: File) {
    setFileName(file.name);
    setFailures([]);

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum 5 MB allowed.");
      return;
    }

    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    // exceljs reads xlsx and csv only — it cannot open the old .xls format, so
    // advertising it meant a silent "Failed to read file" on a file the page had
    // said was fine. Say what to do instead.
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
      // Each sheet keeps its own header row and is mapped independently, so a
      // workbook the owner split across tabs imports whole. Only the first sheet
      // used to be read, which dropped the rest without a word.
      const parsed: { name: string; grid: unknown[][] }[] = [];

      if (ext === ".csv") {
        const text = await file.text();
        const csv = parseCSV(text);
        if (csv.length === 0) {
          toast.error("CSV file is empty.");
          return;
        }
        // Shift each row by one so index 1 = first column (ExcelJS convention)
        parsed.push({ name: file.name, grid: csv.map((r) => ["", ...r]) });
      } else {
        const buffer = await file.arrayBuffer();
        // Runtime-only load: the type import above is erased at compile time, so
        // exceljs stays out of the bundle until a file is actually picked.
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

      const mapped: ImportMemberRow[] = [];
      const sheetReports: SheetReport[] = [];
      const skipCounts: Record<SkipReason, number> = {
        gymId: 0,
        name: 0,
        contact: 0,
        fee: 0,
        expiry: 0,
      };
      const seen = new Set<number>();
      const dupes: string[] = [];
      let firstMapping: Mapping | null = null;

      for (const sheet of parsed) {
        if (sheet.grid.length === 0) {
          sheetReports.push({ name: sheet.name, rows: 0, skipped: "empty" });
          continue;
        }

        const header = findHeader(sheet.grid);
        if (!header) {
          // Named rather than swallowed: a tab the matcher cannot read is
          // reported, so the owner can see it was not imported and why.
          sheetReports.push({
            name: sheet.name,
            rows: 0,
            skipped: "no recognisable column headers",
          });
          continue;
        }

        if (!firstMapping) firstMapping = header.mapping;

        let counted = 0;
        for (const cells of sheet.grid.slice(header.index + 1)) {
          const { cols } = header.mapping;
          const get = (key: FieldKey) => {
            const idx = cols[key];
            // Index 0 is the pad cell the parsers leave at the front, so a
            // column can never legitimately live there.
            return idx === undefined || idx <= 0 ? "" : cells[idx] ?? "";
          };

          const contact = String(get("contactNumber") || "").trim();
          const parsedId = parseGymId(get("gymId"));
          const name = String(get("name") || "").trim();
          const fee = toInt(get("feeAmount"));
          const expiry = excelDateToISO(get("membershipExpiry"));

          if (!parsedId.gymId) skipCounts.gymId++;
          else if (!name) skipCounts.name++;
          else if (!contact) skipCounts.contact++;
          else if (!fee) skipCounts.fee++;
          else if (!expiry) skipCounts.expiry++;
          else if (seen.has(parsedId.gymId)) {
            if (dupes.length < 8) dupes.push(`${parsedId.gymId} (${name})`);
          } else {
            seen.add(parsedId.gymId);
            counted++;

            // No C on the M.No means Hardcore. The owner's register is a
            // complete split — the C marks the cardio clients and everyone else
            // is weights-only — so reading it that way is reading his data, not
            // inventing a value on his behalf.
            const planType: MemberPlanType = parsedId.cardio ? "full" : "no_cardio";

            mapped.push({
              gymId: parsedId.gymId,
              name,
              email: (String(get("email") || "").trim() || null) as string | null,
              contactNumber: contact,
              address: (String(get("address") || "").trim() || null) as string | null,
              parentName: (String(get("parentName") || "").trim() || null) as
                | string
                | null,
              emergencyContact:
                String(get("emergencyContact") || "").trim() || contact || "N/A",
              feeAmount: fee,
              joiningDate: excelDateToISO(get("joiningDate")),
              membershipExpiry: expiry,
              planType,
            });
          }
        }
        sheetReports.push({ name: sheet.name, rows: counted });
      }

      setSheets(sheetReports);
      setMapping(firstMapping);
      setSkipped(skipCounts);
      setDuplicates(dupes);
      setRows(mapped);

      if (mapped.length === 0) {
        toast.error("No valid rows found. Check the columns report below.");
      } else {
        toast.success(`Loaded ${mapped.length} rows`);
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
        }?${updateExisting ? "\n\nMembers already in the system WILL be overwritten." : ""}`
      )
    )
      return;

    setLoading(true);
    setFailures([]);

    let written = 0;
    let skippedExisting = 0;
    const errors: string[] = [];

    try {
      // Sent in chunks rather than as one enormous request: it bounds the
      // payload, keeps every call inside the function's wall-clock budget, and
      // gives the owner something moving to look at on a phone. The original
      // single call ran past the limit and died with the button stuck on
      // "Importing…" and nothing on screen to say so.
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
      } else {
        // Only cleared on a wholly clean run, so a partial import stays on
        // screen with its row count for the owner to act on.
        setRows([]);
        setSheets([]);
        setMapping(null);
        setSkipped(null);
        setDuplicates([]);
        setFileName("");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      // Says how far it got, because a stopped import is not a failed one —
      // everything before this point is committed and skipping it on a re-run is
      // exactly what the default conflict rule does.
      toast.error(`${msg}${written ? ` — ${written} members were imported first` : ""}`);
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

      {/* The file picker is the whole point of the page, so it comes first and
          the column reference folds away underneath it. */}
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
              M.No · Fees · Name · Ph.No · Due Date
            </p>
          </div>
          <div className="adm-field">
            <div className="adm-label" style={{ color: "var(--green2)" }}>
              Optional
            </div>
            <p className="adm-note-text" style={{ marginTop: 0 }}>
              Address · Father Name · Joining Date · Email · Emergency Contact
            </p>
          </div>
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
                already in this branch. Leave off to add only new members.
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
