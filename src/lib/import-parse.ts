/**
 * Reads a gym register out of a spreadsheet. No React, no database.
 *
 * Kept import-free (both imports below are type-only and erase) so
 * `scripts/verify-import-parse.mjs` can run this exact module under Node and
 * check it against a sheet with known answers — a column the matcher fails to
 * recognise is a column of the owner's members that silently never arrives.
 */

import type ExcelJS from "exceljs";
import type { ImportMemberRow, MemberPlanType } from "@/app/actions/import-members";

export function excelDateToISO(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "number") {
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    return utc.toISOString().split("T")[0];
  }

  const s = String(value).trim();

  // Day-first, deliberately: a register typed as text in Delhi means 05/12/2026
  // as 5 December, while V8's own parsing would read it as 12 May and return a
  // confidently wrong date that nothing would flag.
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const valid =
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d;
    if (valid) return date.toISOString().split("T")[0];
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  // Unrecognised: passed through rather than guessed, so the server rejects that
  // one row by name instead of storing a date nobody can verify.
  return s;
}

export function toInt(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : Math.floor(n);
}

// The owner marks cardio clients by writing a C on the M.No — "C123". toInt()
// used to strip it, and the action then stored every imported row as "offline",
// so the only cardio signal in his register was discarded on the way in.
const CARDIO_PATTERNS = [
  /^c\s*[-./]?\s*(\d+)$/i, // C123, C 123, c.123, C-123, C/123
  /^(\d+)\s*[-./]?\s*c$/i, // 123C, 123 C
  /^(\d+)\s*\(\s*c\s*\)$/i, // 123(C)
];

export function parseGymId(raw: unknown): { gymId: number; cardio: boolean } {
  const s = String(raw ?? "").trim();
  if (!s) return { gymId: 0, cardio: false };
  for (const re of CARDIO_PATTERNS) {
    const m = s.match(re);
    if (m) return { gymId: Math.floor(Number(m[1])), cardio: true };
  }
  // Clamped at zero: "M-123" reads through toInt as -123, and a negative id
  // would show in the preview as ready only for the server to reject it.
  const plain = toInt(s);
  return { gymId: plain > 0 ? plain : 0, cardio: false };
}

export function cellValue(cell: ExcelJS.Cell): unknown {
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

/** Minimal RFC-4180-ish CSV: quoted fields, escaped quotes, \n and \r\n. */
export function parseCSV(text: string): string[][] {
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
          i++;
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
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ===== Column matching =====
// Pass 1 compares the header against known spellings. Pass 2 picks up whatever
// is still unmatched by keyword, so a column headed "Mobile No" or "Valid Upto"
// is recognised instead of dropped. Field order matters — a keyword as loose as
// "name" would otherwise take "Father Name" first — and the genuinely ambiguous
// ones carry an explicit `exclude`.

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
  /** Missing this is not fatal; the import fills in today's date. */
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

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export type Mapping = {
  cols: Partial<Record<FieldKey, number>>;
  matched: { label: string; header: string }[];
  ignored: string[];
  missing: string[];
  warnMissing: string[];
};

export function matchColumns(headers: string[]): Mapping {
  const normalised = headers.map(norm);
  const taken = new Set<number>();
  const cols: Partial<Record<FieldKey, number>> = {};

  // `?? ""` because the grid is sparse — index 0 is the pad cell the parsers
  // leave at the front of every row, so it can read back as undefined.
  const claimable = (i: number, spec: FieldSpec) => {
    const h = normalised[i] ?? "";
    return (
      h !== "" &&
      !taken.has(i) &&
      !(spec.exclude ?? []).some((x) => h.includes(x))
    );
  };

  for (const spec of FIELDS) {
    for (const alias of spec.aliases) {
      const want = norm(alias);
      const idx = normalised.findIndex((h, i) => claimable(i, spec) && h === want);
      if (idx !== -1) {
        cols[spec.key] = idx;
        taken.add(idx);
        break;
      }
    }
  }

  for (const spec of FIELDS) {
    if (cols[spec.key] !== undefined) continue;
    const idx = normalised.findIndex(
      (h, i) => claimable(i, spec) && spec.keywords.some((k) => (h ?? "").includes(k))
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
    ignored: headers.filter((h, i) => (h ?? "").trim() !== "" && !taken.has(i)),
    missing: FIELDS.filter((f) => f.required && cols[f.key] === undefined).map(
      (f) => f.label
    ),
    warnMissing: FIELDS.filter(
      (f) => f.warnIfMissing && cols[f.key] === undefined
    ).map((f) => f.label),
  };
}

/** A register often opens with a title above the column names, so the first ten
 *  rows are tried and the first matching three required columns wins. */
export function findHeader(
  grid: unknown[][]
): { index: number; mapping: Mapping } | null {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const headers = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    const mapping = matchColumns(headers);
    const found = REQUIRED_KEYS.filter((k) => mapping.cols[k] !== undefined).length;
    if (found >= 3) return { index: i, mapping };
  }
  return null;
}

export type SkipReason = "gymId" | "name" | "contact" | "fee" | "expiry";

export const SKIP_LABELS: Record<SkipReason, string> = {
  gymId: "no M.No",
  name: "no name",
  contact: "no phone number",
  fee: "no fee",
  expiry: "no due date",
};

export type SheetReport = { name: string; rows: number; skipped?: string };

export type ParsedSheet = { name: string; grid: unknown[][] };

export type ParseResult = {
  rows: ImportMemberRow[];
  sheets: SheetReport[];
  mapping: Mapping | null;
  skipped: Record<SkipReason, number>;
  duplicates: string[];
};

/**
 * Turns every sheet of a workbook into import rows. A sheet that cannot be read
 * is named rather than dropped, and a row that cannot be imported is counted
 * against the reason it failed, so the screen can say "3 with no phone number"
 * instead of an unexplained shortfall. Rows are deduped on M.No across the whole
 * workbook.
 */
export function parseSheets(parsed: ParsedSheet[]): ParseResult {
  const rows: ImportMemberRow[] = [];
  const sheets: SheetReport[] = [];
  const skipped: Record<SkipReason, number> = {
    gymId: 0,
    name: 0,
    contact: 0,
    fee: 0,
    expiry: 0,
  };
  const seen = new Set<number>();
  const duplicates: string[] = [];
  let mapping: Mapping | null = null;

  for (const sheet of parsed) {
    if (sheet.grid.length === 0) {
      sheets.push({ name: sheet.name, rows: 0, skipped: "empty" });
      continue;
    }

    const header = findHeader(sheet.grid);
    if (!header) {
      sheets.push({
        name: sheet.name,
        rows: 0,
        skipped: "no recognisable column headers",
      });
      continue;
    }

    if (!mapping) mapping = header.mapping;
    const { cols } = header.mapping;
    const get = (key: FieldKey, cells: unknown[]) => {
      const idx = cols[key];
      return idx === undefined || idx <= 0 ? "" : cells[idx] ?? "";
    };

    let counted = 0;
    for (const cells of sheet.grid.slice(header.index + 1)) {
      const contact = String(get("contactNumber", cells) || "").trim();
      const parsedId = parseGymId(get("gymId", cells));
      const name = String(get("name", cells) || "").trim();
      const fee = toInt(get("feeAmount", cells));
      const expiry = excelDateToISO(get("membershipExpiry", cells));

      if (!parsedId.gymId) skipped.gymId++;
      else if (!name) skipped.name++;
      else if (!contact) skipped.contact++;
      else if (!fee) skipped.fee++;
      else if (!expiry) skipped.expiry++;
      else if (seen.has(parsedId.gymId)) {
        if (duplicates.length < 8) duplicates.push(`${parsedId.gymId} (${name})`);
      } else {
        seen.add(parsedId.gymId);
        counted++;

        // No C on the M.No means Hardcore: the register is a complete split, so
        // reading it that way is reading his data, not inventing a value.
        const planType: MemberPlanType = parsedId.cardio ? "full" : "no_cardio";

        rows.push({
          gymId: parsedId.gymId,
          name,
          email: String(get("email", cells) || "").trim() || null,
          contactNumber: contact,
          address: String(get("address", cells) || "").trim() || null,
          parentName: String(get("parentName", cells) || "").trim() || null,
          emergencyContact:
            String(get("emergencyContact", cells) || "").trim() || contact || "N/A",
          feeAmount: fee,
          joiningDate: excelDateToISO(get("joiningDate", cells)),
          membershipExpiry: expiry,
          planType,
        });
      }
    }
    sheets.push({ name: sheet.name, rows: counted });
  }

  return { rows, sheets, mapping, skipped, duplicates };
}
