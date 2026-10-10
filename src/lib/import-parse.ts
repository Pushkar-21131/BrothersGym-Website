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

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel counts days from 1899-12-30, which is what the 25569 corrects for. */
function fromSerial(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const utc = new Date(Math.round((n - 25569) * 86400 * 1000));
  return isNaN(utc.getTime()) ? "" : utc.toISOString().split("T")[0];
}

export function excelDateToISO(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString().split("T")[0];
  }

  if (typeof value === "number") return fromSerial(value);

  const s = String(value).trim();
  if (!s) return "";

  // A serial stored as text ("45566") must be read as a serial. Left to
  // new Date() it is taken for a YEAR and returns "+045565-12-31" — non-empty,
  // not a date, and rejected by Postgres, which fails the whole 250-row
  // statement it is in. Five digits and up only: a bare "2026" is likelier to be
  // the year the owner meant than serial 2026, which is 1905.
  if (/^\d{5,6}$/.test(s)) return fromSerial(Number(s));

  // Day-first, deliberately: a register typed as text in Delhi means 05/12/2026
  // as 5 December, while V8's own parsing would read it as 12 May and return a
  // confidently wrong date that nothing would flag. Two-digit years are included
  // for the same reason — "07-10-26" previously fell past this and came back as
  // 9 July, a three-month error. A trailing time is ignored, not fatal.
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y =
      dmy[3].length === 2
        ? Number(dmy[3]) + (Number(dmy[3]) < 70 ? 2000 : 1900)
        : Number(dmy[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    const valid =
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d;
    if (valid) return date.toISOString().split("T")[0];
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    // Read back from the LOCAL parts, not toISOString(): "07 Oct 2026" lands at
    // local midnight, so UTC would report the 6th for anyone east of Greenwich.
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Unreadable, so empty rather than passed through. The old passthrough sent the
  // raw string to the insert, where Postgres refused it and took the other 249
  // rows of the statement down with it. Empty means "not known", which the server
  // dates today — the same treatment as a blank cell, and it cannot fail a chunk.
  return "";
}

export function toInt(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : Math.floor(n);
}

export type Sex = "male" | "female" | "other";

/**
 * "M" / "Male" / "Man" / "F" as the owner's register writes them, for both the
 * member import and the enquiry one. Lives here rather than in enquiry-parse.ts
 * because that module already imports from this one, and the member import has to
 * read the same column the same way.
 */
export function parseSex(raw: unknown): Sex | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(m|male|man|boy)$/.test(s)) return "male";
  if (/^(f|female|woman|girl)$/.test(s)) return "female";
  if (/^(o|other)$/.test(s)) return "other";
  return null;
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

/**
 * The register's own Cardio/Hardcore column, read as a plan.
 *
 * The C on the M.No is one way the owner records the tier and this column is the
 * other, and his book carries both. Only the C was ever read, so a sheet that
 * spells the tier out — and a register whose C column is blank for a stretch —
 * arrived as Hardcore instead of what it says. Null (not "no_cardio") is the
 * answer for a blank or unrecognised cell, so the C still decides whenever this
 * column has nothing to say.
 */
export function parsePlanType(raw: unknown): MemberPlanType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  // "Hardcore" is often written out as "Hardcore (No Cardio)", so the negative
  // has to be tested before the word inside it.
  if (s.includes("hard") || s.includes("no cardio") || s.includes("without"))
    return "no_cardio";
  if (s.includes("cardio")) return "full";
  return null;
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
  | "email"
  | "gender"
  | "planType";

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
    // Optional, like joiningDate — a register with no such column still imports
    // exactly as it did before. The register writes it as "Sex", hence the
    // aliases; parseSex() below turns M/F/Male/Woman into one value.
    key: "gender",
    label: "Gender",
    aliases: ["sex", "gender", "mf", "m/f"],
    keywords: ["sex", "gender"],
  },
  {
    // Optional, like gender. The register's own tier column, sitting beside the C
    // on the M.No — see parsePlanType(). A sheet without one imports exactly as
    // it did before.
    key: "planType",
    label: "Cardio/Hardcore",
    aliases: ["cardiohardcore", "cardio", "hardcore"],
    keywords: ["cardio", "hardcore"],
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

export type SkipReason = "gymId" | "name" | "fee";

export const SKIP_LABELS: Record<SkipReason, string> = {
  gymId: "no M.No",
  name: "no name",
  fee: "no fee",
};

export type SheetReport = { name: string; rows: number; skipped?: string };

export type ParsedSheet = { name: string; grid: unknown[][] };

export type ParseResult = {
  rows: ImportMemberRow[];
  sheets: SheetReport[];
  mapping: Mapping | null;
  skipped: Record<SkipReason, number>;
  duplicates: string[];
  /** Rows imported with no phone number on file. */
  withoutPhone: number;
  /** Rows with no readable due date. The server dates these today. */
  withoutDueDate: number;
  /**
   * How many of those had something in the cell that could not be read, as
   * opposed to nothing at all. The two need opposite responses — one is a gap in
   * the owner's book, the other is our reader failing on his data — so the screen
   * must not report them as a single number.
   */
  unreadableDueDate: number;
  /** The first few of those, named so the owner can correct them. */
  datedToday: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns every sheet of a workbook into import rows. A sheet that cannot be read
 * is named rather than dropped, and a row that cannot be imported is counted
 * against the reason it failed, so the screen can say "3 with no fee" instead of
 * an unexplained shortfall. Rows are deduped on M.No across the whole workbook.
 *
 * A missing phone or due date does not disqualify a row — the owner's register
 * has gaps in both, and a member with no number is still a member. They import
 * anyway and are counted here, because an unremarked-on gap is one he cannot see
 * or fix.
 */
export function parseSheets(parsed: ParsedSheet[]): ParseResult {
  const rows: ImportMemberRow[] = [];
  const sheets: SheetReport[] = [];
  const skipped: Record<SkipReason, number> = { gymId: 0, name: 0, fee: 0 };
  const seen = new Set<number>();
  const duplicates: string[] = [];
  const unreadable: string[] = [];
  const blank: string[] = [];
  let withoutPhone = 0;
  let withoutDueDate = 0;
  let unreadableDueDate = 0;
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
      // A blank cell and an unreadable one both mean "not known"; the server
      // dates those today. The raw text is kept for the report, because when
      // most of a column fails to read, the shape of what failed is the whole
      // diagnosis — and it separates "he has not filled this in" from "we could
      // not read what he filled in", which need opposite responses.
      const rawExpiryCell = get("membershipExpiry", cells);
      const rawExpiry = excelDateToISO(rawExpiryCell);
      const expiry = ISO_DATE.test(rawExpiry) ? rawExpiry : "";

      if (!parsedId.gymId) skipped.gymId++;
      else if (!name) skipped.name++;
      else if (!fee) skipped.fee++;
      else if (seen.has(parsedId.gymId)) {
        if (duplicates.length < 8) duplicates.push(`${parsedId.gymId} (${name})`);
      } else {
        seen.add(parsedId.gymId);
        counted++;
        if (!contact) withoutPhone++;
        if (!expiry) {
          withoutDueDate++;
          const shown = String(rawExpiryCell ?? "").trim();
          if (shown) {
            unreadableDueDate++;
            if (unreadable.length < 8)
              unreadable.push(`${parsedId.gymId} (${name}) — "${shown}"`);
          } else if (blank.length < 8) {
            blank.push(`${parsedId.gymId} (${name})`);
          }
        }

        // His own tier column when it has something to say, else the C on the
        // M.No. No C and no column means Hardcore: the register is a complete
        // split, so reading it that way is reading his data, not inventing one.
        const planType: MemberPlanType =
          parsePlanType(get("planType", cells)) ??
          (parsedId.cardio ? "full" : "no_cardio");

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
          gender: parseSex(get("gender", cells)),
        });
      }
    }
    sheets.push({ name: sheet.name, rows: counted });
  }

  return {
    rows,
    sheets,
    mapping,
    skipped,
    duplicates,
    withoutPhone,
    withoutDueDate,
    unreadableDueDate,
    // Unreadable first: those are the samples that need acting on, and the blank
    // ones would otherwise crowd them out of a list capped at eight.
    datedToday: [...unreadable, ...blank].slice(0, 8),
  };
}
