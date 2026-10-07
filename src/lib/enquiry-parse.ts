/**
 * Reads the owner's enquiry list out of a spreadsheet. No React, no database.
 *
 * Kept import-free (the ExcelJS import is type-only and erases) so
 * `scripts/verify-enquiry-parse.mjs` can run this exact module under Node — the
 * same arrangement as import-parse.ts, whose date and cell helpers this reuses
 * rather than reimplementing. Day-first dates in particular: "05/12/2026" is
 * 5 December here, and a second parser of our own would eventually disagree.
 */

import { excelDateToISO } from "@/lib/import-parse";

export type EnquirySex = "male" | "female" | "other";

export type ImportEnquiryRow = {
  name: string;
  phone?: string | null;
  sex?: EnquirySex | null;
  inquiryDate?: string;
  note?: string | null;
};

type FieldKey = "name" | "phone" | "sex" | "inquiryDate" | "note";

type FieldSpec = {
  key: FieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
  keywords: string[];
  exclude?: string[];
};

// Order matters: the keyword pass gives each field the first unclaimed column
// it matches, so a loose keyword on a late field could otherwise take a column
// that belongs to an earlier one.
const FIELDS: FieldSpec[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["name", "membername", "fullname", "customername", "enquiryname"],
    keywords: ["name"],
    exclude: ["father", "mother", "parent", "guardian", "gym", "trainer"],
  },
  {
    key: "phone",
    label: "Phone",
    aliases: [
      "phone", "phoneno", "phno", "ph", "contact", "contactno", "contactnumber",
      "mobile", "mobileno", "cellno", "whatsapp", "number", "no",
    ],
    keywords: ["phone", "mobile", "contact", "cell", "whatsapp"],
    exclude: ["emergency"],
  },
  {
    key: "sex",
    label: "Sex",
    aliases: ["sex", "gender", "mf"],
    keywords: ["sex", "gender"],
  },
  {
    key: "inquiryDate",
    // Exact aliases only. "Date" alone as a keyword would swallow whichever
    // date column a wider sheet happens to have.
    label: "Date of Inquiry",
    aliases: [
      "dateofinquiry", "dateofenquiry", "inquirydate", "enquirydate", "doe",
      "doi", "date", "inquiry", "enquiry",
    ],
    keywords: ["inquiry", "enquiry"],
  },
  {
    key: "note",
    label: "Note",
    aliases: ["note", "notes", "remark", "remarks", "comment", "comments", "days"],
    keywords: ["note", "remark", "comment", "day"],
  },
];

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "M" / "Male" / "F" / "Female" as the register writes them. */
export function parseSex(raw: unknown): EnquirySex | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(m|male|man|boy)$/.test(s)) return "male";
  if (/^(f|female|woman|girl)$/.test(s)) return "female";
  if (/^(o|other)$/.test(s)) return "other";
  return null;
}

/** Digits only, so a "+91 98765 43210" and a "098765-43210" compare equal. */
function phoneDigits(raw: unknown) {
  return String(raw ?? "").replace(/\D/g, "");
}

export type Mapping = {
  cols: Partial<Record<FieldKey, number>>;
  matched: { label: string; header: string }[];
  ignored: string[];
  missing: string[];
};

export function matchEnquiryColumns(headers: string[]): Mapping {
  const normalised = headers.map(norm);
  const taken = new Set<number>();
  const cols: Partial<Record<FieldKey, number>> = {};

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
  };
}

/** The paper form carries a title above the column names, so the first ten
 *  rows are tried. Name plus one other column is the bar. */
export function findEnquiryHeader(
  grid: unknown[][]
): { index: number; mapping: Mapping } | null {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const headers = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    const mapping = matchEnquiryColumns(headers);
    if (mapping.cols.name !== undefined && mapping.matched.length >= 2) {
      return { index: i, mapping };
    }
  }
  return null;
}

export type EnquirySheetReport = { name: string; rows: number; skipped?: string };

export type EnquiryParsedSheet = { name: string; grid: unknown[][] };

export type EnquiryParseResult = {
  rows: ImportEnquiryRow[];
  sheets: EnquirySheetReport[];
  mapping: Mapping | null;
  /** Rows dropped because the Name cell was empty. */
  skippedNoName: number;
  /** Rows imported with no phone number — they cannot be messaged. */
  withoutPhone: number;
  /** Repeat entries in the file, named so the owner can see what was left out. */
  duplicates: string[];
};

/**
 * Turns every sheet of a workbook into enquiry rows.
 *
 * A row with no phone still imports — a walk-in who left no number is a lead,
 * and dropping it would lose the record entirely. It is counted so the screen
 * can say so, because an unremarked-on gap is one the owner cannot act on.
 */
export function parseEnquirySheets(
  parsed: EnquiryParsedSheet[]
): EnquiryParseResult {
  const rows: ImportEnquiryRow[] = [];
  const sheets: EnquirySheetReport[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  let skippedNoName = 0;
  let withoutPhone = 0;
  let mapping: Mapping | null = null;

  for (const sheet of parsed) {
    if (sheet.grid.length === 0) {
      sheets.push({ name: sheet.name, rows: 0, skipped: "empty" });
      continue;
    }

    const header = findEnquiryHeader(sheet.grid);
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
      const name = String(get("name", cells) ?? "").trim();
      if (!name) {
        // A fully blank row is padding, not a mistake worth reporting.
        if (cells.some((c) => String(c ?? "").trim() !== "")) skippedNoName++;
        continue;
      }

      const rawPhone = String(get("phone", cells) ?? "").trim();
      const phone = rawPhone || null;
      if (!phone) withoutPhone++;

      // Deduped on name + phone, not name alone: two people can share a name,
      // and nothing in this sheet is a real key. This is what stops a re-run of
      // the same file from doubling the list.
      const key = `${name.toLowerCase()}|${phoneDigits(phone)}`;
      if (seen.has(key)) {
        if (duplicates.length < 8) duplicates.push(phone ? `${name} (${phone})` : name);
        continue;
      }
      seen.add(key);
      counted++;

      const rawDate = excelDateToISO(get("inquiryDate", cells));
      rows.push({
        name,
        phone,
        sex: parseSex(get("sex", cells)),
        inquiryDate: ISO_DATE.test(rawDate) ? rawDate : "",
        note: String(get("note", cells) ?? "").trim() || null,
      });
    }

    sheets.push({ name: sheet.name, rows: counted });
  }

  return { rows, sheets, mapping, skippedNoName, withoutPhone, duplicates };
}
