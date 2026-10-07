/**
 * Checks the register reader against a synthetic sheet with known answers.
 *
 *   node scripts/verify-import-parse.mjs
 *
 * Imports the real src/lib/import-parse.ts, so it cannot drift from what the
 * browser runs. Node 24 strips the types natively.
 */

import ExcelJS from "exceljs";
import {
  parseSheets,
  parseGymId,
  excelDateToISO,
  cellValue,
} from "../src/lib/import-parse.ts";

let failures = 0;
let checks = 0;

function ok(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          got      ${a}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ===== expected answers, fixed by construction =====
const NR_MEMBERS = 1200; // first tab, gymId 1..1200
const NR_CARDIO = 300; // every 4th
const SP_MEMBERS = 300; // second tab, gymId 2001..2300
const SP_CARDIO = 30; // every 10th
const EXTRA_CARDIO = 3; // C 8007, 8045C, 8050(C)
const EXTRA_ROWS = 6; // those three, plus 9002 (no phone), 9005 (no due date), 9006 (unreadable)
const EXPIRY = "2026-12-31";

const expiryDate = new Date(Date.UTC(2026, 11, 31));

function buildWorkbook() {
  const wb = new ExcelJS.Workbook();

  // ---- Tab 1: a title above the header, extra columns, a renamed expiry ----
  const nr = wb.addWorksheet("NR Register");
  nr.addRow(["BROTHERS GYM - MEMBER LIST (NANGAL RAYA)"]);
  nr.addRow([
    "Serial No", // ignored
    "M.No",
    "Name",
    "Father Name",
    "Ph.No",
    "EXPIRY DT", // not a known spelling; must still be matched
    "Fees",
    "Joining Date",
    "Remarks", // ignored
  ]);
  for (let i = 1; i <= NR_MEMBERS; i++) {
    const cardio = i % 4 === 0;
    nr.addRow([
      i,
      cardio ? `C${i}` : i,
      `Member ${i}`,
      `Father ${i}`,
      `98${String(1000000 + i).slice(-7)}`,
      expiryDate,
      500,
      expiryDate,
      "—",
    ]);
  }

  // ---- Tab 2: different headings, different order, no ignored columns ----
  const sp = wb.addWorksheet("SP Register");
  sp.addRow(["Mobile No", "Member Name", "M.No", "Due Date", "Amount"]);
  for (let i = 1; i <= SP_MEMBERS; i++) {
    const cardio = i % 10 === 0;
    sp.addRow([
      `97${String(2000000 + i).slice(-7)}`,
      `SP Member ${i}`,
      cardio ? `C${2000 + i}` : 2000 + i,
      expiryDate,
      800,
    ]);
  }

  // ---- Tab 3: every way a row can be unusable, plus the C variants ----
  const extras = wb.addWorksheet("Extras");
  extras.addRow(["M.No", "Name", "Ph.No", "EXPIRY DT", "Fees"]);
  extras.addRow([5, "Duplicate Row", "9999900001", expiryDate, 500]);
  extras.addRow([9001, null, "9999900002", expiryDate, 500]); // no name
  extras.addRow([9002, "No Phone", null, expiryDate, 500]); // no phone
  extras.addRow([9003, "No Fee", "9999900003", expiryDate, 0]); // no fee
  extras.addRow([null, "No Id", "9999900004", expiryDate, 500]); // no M.No
  extras.addRow([9005, "No Due", "9999900005", null, 500]); // no due date
  // The case that broke production: a due date that is present but unreadable.
  // It must be told apart from the blank one above, because one is a gap in the
  // owner's book and the other is a reader that cannot handle his format.
  extras.addRow([9006, "Unreadable Due", "9999900009", "sometime next year", 500]);
  extras.addRow(["C 8007", "Cardio Space", "9999900006", expiryDate, 700]);
  extras.addRow(["8045C", "Cardio Suffix", "9999900007", expiryDate, 700]);
  extras.addRow(["8050(C)", "Cardio Paren", "9999900008", expiryDate, 700]);

  return wb;
}

/** Exactly how import-members-client.tsx turns a worksheet into a grid. */
function gridOf(worksheet) {
  const grid = [];
  worksheet.eachRow((row, rowNum) => {
    const cells = [];
    row.eachCell((cell, colNum) => {
      cells[colNum] = cellValue(cell);
    });
    grid[rowNum] = cells;
  });
  return grid.filter((r) => r !== undefined);
}

// ===== 1. the M.No "C" convention =====
group("M.No parsing (the owner's Cardio convention)");
ok('"C123"', parseGymId("C123"), { gymId: 123, cardio: true });
ok('"c 123"', parseGymId("c 123"), { gymId: 123, cardio: true });
ok('"C-123"', parseGymId("C-123"), { gymId: 123, cardio: true });
ok('"c.123"', parseGymId("c.123"), { gymId: 123, cardio: true });
ok('"C/123"', parseGymId("C/123"), { gymId: 123, cardio: true });
ok('"123C"', parseGymId("123C"), { gymId: 123, cardio: true });
ok('"123 C"', parseGymId("123 C"), { gymId: 123, cardio: true });
ok('"123(C)"', parseGymId("123(C)"), { gymId: 123, cardio: true });
ok('"123" (plain)', parseGymId("123"), { gymId: 123, cardio: false });
ok("123 (number cell)", parseGymId(123), { gymId: 123, cardio: false });
ok('"" (blank)', parseGymId(""), { gymId: 0, cardio: false });
// Must not become a negative id and slip past the "ready" check.
ok('"M-123" (malformed)', parseGymId("M-123"), { gymId: 0, cardio: false });
ok('"123-A" (malformed)', parseGymId("123-A"), { gymId: 0, cardio: false });

group("Date parsing");
ok("Date object", excelDateToISO(expiryDate), EXPIRY);
ok("Excel serial 45000", excelDateToISO(45000), "2023-03-15");
ok('"31-12-2026"', excelDateToISO("31-12-2026"), "2026-12-31");
ok('"" (blank)', excelDateToISO(""), "");
ok("null", excelDateToISO(null), "");

// The shapes that used to reach Postgres and take a whole 250-row statement
// down with them, or that came back as a confidently wrong day.
group("Date parsing — the values that used to break the import");
ok('"45566" (serial stored as text)', excelDateToISO("45566"), "2024-10-01");
ok('"07-10-26" (two-digit year)', excelDateToISO("07-10-26"), "2026-10-07");
ok('"01/10/24" (two-digit year)', excelDateToISO("01/10/24"), "2024-10-01");
ok('"31-12-2026 00:00:00"', excelDateToISO("31-12-2026 00:00:00"), "2026-12-31");
ok('"07 Oct 2026" (no UTC shift)', excelDateToISO("07 Oct 2026"), "2026-10-07");
ok('"not-a-date"', excelDateToISO("not-a-date"), "");
ok('"31-02-2026" (no such day)', excelDateToISO("31-02-2026"), "");
ok('"2026" (a bare year)', excelDateToISO("2026"), "2026-01-01");

// ===== 2. the whole workbook, through Excel =====
group("Workbook round-trip");

const buffer = await buildWorkbook().xlsx.writeBuffer();
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);

const parsed = wb.worksheets.map((ws) => ({ name: ws.name, grid: gridOf(ws) }));
ok(
  "sheets read",
  parsed.map((p) => p.name),
  ["NR Register", "SP Register", "Extras"]
);

const result = parseSheets(parsed);
const cardio = result.rows.filter((r) => r.planType === "full").length;
const hardcore = result.rows.filter((r) => r.planType === "no_cardio").length;

const expectedRows = NR_MEMBERS + SP_MEMBERS + EXTRA_ROWS;
const expectedCardio = NR_CARDIO + SP_CARDIO + EXTRA_CARDIO;

ok("every usable row landed", result.rows.length, expectedRows);
ok("cardio counted", cardio, expectedCardio);
ok("hardcore counted", hardcore, expectedRows - expectedCardio);
ok(
  "nothing left undecided",
  result.rows.filter((r) => r.planType === "offline").length,
  0
);

// The renamed column is the whole point of the keyword fallback: it must be
// reported as matched, not quietly dropped along with the 1500 due dates in it.
ok(
  "renamed expiry column reported as matched",
  result.mapping?.matched.find((m) => m.label === "Due Date"),
  { label: "Due Date", header: "EXPIRY DT" }
);
ok("no required column missing", result.mapping?.missing, []);
ok(
  "extra columns reported as ignored",
  result.mapping?.ignored,
  ["Serial No", "Remarks"]
);

group("Per-sheet counts");
ok("sheet report", result.sheets, [
  { name: "NR Register", rows: NR_MEMBERS },
  { name: "SP Register", rows: SP_MEMBERS },
  { name: "Extras", rows: EXTRA_ROWS },
]);

group("Rows that could not be imported");
ok("breakdown by reason", result.skipped, { gymId: 1, name: 1, fee: 1 });
ok("repeated M.No named", result.duplicates, ["5 (Duplicate Row)"]);

group("Rows imported despite a gap");
const byId = new Map(result.rows.map((r) => [r.gymId, r]));
ok("no phone counted", result.withoutPhone, 1);
ok("no due date counted", result.withoutDueDate, 2);
ok("the unreadable one counted apart from the blank one", result.unreadableDueDate, 1);
ok("both rows named, the unreadable one quoted first", result.datedToday, [
  '9006 (Unreadable Due) — "sometime next year"',
  "9005 (No Due)",
]);
ok("a member with no phone still imported", byId.get(9002)?.contactNumber, "");
ok("...and still gets a plan", byId.get(9002)?.planType, "no_cardio");
ok("no due date sent blank for the server to date", byId.get(9005)?.membershipExpiry, "");
ok(
  "an unreadable due date is sent blank, not passed through",
  byId.get(9006)?.membershipExpiry,
  ""
);
ok("no name is still rejected", byId.has(9001), false);
ok("no fee is still rejected", byId.has(9003), false);
ok("no M.No is still rejected", byId.has(9004), false);

group("Representative rows");
ok("gymId 7 is hardcore", byId.get(7)?.planType, "no_cardio");
ok("gymId 8 is cardio", byId.get(8)?.planType, "full");
ok("gymId 2001 is hardcore", byId.get(2001)?.planType, "no_cardio");
ok("gymId 2010 is cardio", byId.get(2010)?.planType, "full");
ok("C 8007 (space) is cardio", byId.get(8007)?.planType, "full");
ok("8045C (suffix) is cardio", byId.get(8045)?.planType, "full");
ok("8050(C) (parens) is cardio", byId.get(8050)?.planType, "full");

const seven = byId.get(7);
ok("expiry survived as a date", seven?.membershipExpiry, EXPIRY);
ok("name read from the Name column", seven?.name, "Member 7");
ok("father name read from Father Name", seven?.parentName, "Father 7");
ok("fee read from Fees", seven?.feeAmount, 500);
ok(
  "emergency contact falls back to the phone number",
  seven?.emergencyContact,
  seven?.contactNumber
);
ok("Tab 2 name read from Member Name", byId.get(2001)?.name, "SP Member 1");
ok("Tab 2 fee read from Amount", byId.get(2001)?.feeAmount, 800);

// ===== 3. one number per member =====
group("120 and C120 in the same file");
const clash = parseSheets([
  {
    name: "Clash",
    grid: [
      ["", "M.No", "Name", "Ph.No", "Due Date", "Fees"],
      ["", "120", "Plain Row", "9811100001", expiryDate, 500],
      ["", "C120", "Cardio Row", "9811100002", expiryDate, 500],
    ],
  },
]);
ok("only one row kept", clash.rows.length, 1);
ok("the first wins", clash.rows[0]?.name, "Plain Row");
ok("the clash is named", clash.duplicates, ["120 (Cardio Row)"]);

// ===== summary =====
console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`
);
process.exit(failures === 0 ? 0 : 1);
