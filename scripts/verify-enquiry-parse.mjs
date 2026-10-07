/**
 * Checks the enquiry reader against a synthetic sheet with known answers.
 *
 *   node scripts/verify-enquiry-parse.mjs
 *
 * Imports the real src/lib/enquiry-parse.ts, so it cannot drift from what the
 * browser runs. Node 24 strips the types natively.
 *
 * Unlike import-parse.ts, the module under test value-imports through the "@/"
 * alias, which Node has no way to resolve on its own — hence the resolver hook
 * below. It has to be registered before the import, so that import is dynamic.
 */

import { registerHooks } from "node:module";
import ExcelJS from "exceljs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const target = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
    return nextResolve(target.href, context);
  },
});

const { parseEnquirySheets, parseSex, matchEnquiryColumns, findEnquiryHeader } =
  await import("../src/lib/enquiry-parse.ts");
const { cellValue, parseCSV } = await import("../src/lib/import-parse.ts");

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
// Page 1 keeps the paper form exactly as printed, five usable rows.
const PAGE1_ROWS = 5;
const PAGE2_ROWS = 1;

function buildWorkbook() {
  const wb = new ExcelJS.Workbook();

  // ---- Page 1: the printed form, title row included ----
  const page1 = wb.addWorksheet("Enquiry List");
  page1.addRow(["BROTHERS GYM ENQUIRY LIST"]);
  page1.addRow(["S.No", "Name", "Sex", "Date of Inquiry", "Phone Number", "Note"]);
  page1.addRow([1, "Ramesh Kumar", "M", "05-12-2026", 9876543210, "Monday, Thursday"]);
  page1.addRow([2, "Sunita Devi", "F", "07-10-26", 9812345678, "Sunday"]);
  page1.addRow([3, "Walk In", "M", "12-11-2026", null, "came at 6pm"]); // no phone
  page1.addRow([4, "No Date", "F", null, 9876500011, null]); // no inquiry date
  page1.addRow([5, "Ramesh Kumar", null, null, 9876543210, null]); // repeat
  page1.addRow([6, null, "M", null, 9876500022, null]); // no name
  page1.addRow([null, null, null, null, null, null]); // padding
  // The value that broke the member import: present but unreadable. It must go
  // out empty (the server dates it today) rather than reach Postgres as text.
  page1.addRow([7, "Garbage Date", "M", "sometime next year", 9876500033, null]);

  // ---- Page 2: the owner's other spellings, order shuffled ----
  const page2 = wb.addWorksheet("Page 2");
  page2.addRow(["ENQUIRY - SECOND PAGE"]);
  page2.addRow(["S No", "Enquiry Name", "Gender", "Enquiry Date", "Mobile No", "Days"]);
  page2.addRow([1, "Anil Sharma", "Male", "01/10/24", "+91 98765 43210", "Tue, Fri"]);

  // A tab with nothing on it, and one that is not an enquiry sheet at all.
  wb.addWorksheet("Notes");
  const scratch = wb.addWorksheet("Scratch");
  scratch.addRow(["left", "right"]);
  scratch.addRow(["c", "d"]);

  return wb;
}

/** Exactly how enquiry-import.tsx turns a worksheet into a grid. */
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

// ===== 1. column matching =====
group("Headings the owner might type");
const father = matchEnquiryColumns(["Father Name", "Name"]);
ok('"Father Name" is not the enquiry name', father.cols.name, 1);
ok("...and is reported as ignored, not silently eaten", father.ignored, ["Father Name"]);
const emergency = matchEnquiryColumns(["Emergency Contact", "Ph.No", "Name"]);
ok('"Emergency Contact" is not the phone number', emergency.cols.phone, 1);
ok('"Ph.No" is', matchEnquiryColumns(["Ph.No", "Name"]).cols.phone, 0);
ok(
  "a column matching nothing is reported back to the owner",
  matchEnquiryColumns(["Name", "Ph.No", "Blood Group"]).ignored,
  ["Blood Group"]
);
ok(
  '"Remarks" is the Note column, not an extra one',
  matchEnquiryColumns(["Name", "Ph.No", "Remarks"]).cols.note,
  2
);
ok(
  "no Name column is a missing required column",
  matchEnquiryColumns(["Sex", "Phone"]).missing,
  ["Name"]
);

group("Finding the header under a title");
const titled = findEnquiryHeader([
  ["BROTHERS GYM ENQUIRY LIST"],
  ["", ""],
  ["S.No", "Name", "Phone Number"],
]);
ok("the title row is skipped", titled?.index, 2);
ok("the real header is used", titled?.mapping.cols.name, 1);
ok(
  "one recognised column is not enough to call it a header",
  findEnquiryHeader([["Sex", "Remarks"]]),
  null
);
ok("nor is a sheet of bare numbers", findEnquiryHeader([["1", "2", "3"]]), null);

// ===== 2. sex, as a register writes it =====
group("Sex");
ok('"M"', parseSex("M"), "male");
ok('"male"', parseSex("male"), "male");
ok('"F"', parseSex("F"), "female");
ok('"Woman"', parseSex("Woman"), "female");
ok('"Other"', parseSex("Other"), "other");
ok('"" (blank)', parseSex(""), null);
ok('"Mr" (a title, not a sex)', parseSex("Mr"), null);
ok("null", parseSex(null), null);

// ===== 3. the whole workbook, through Excel =====
group("Workbook round-trip");

const buffer = await buildWorkbook().xlsx.writeBuffer();
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);

const parsed = wb.worksheets.map((ws) => ({ name: ws.name, grid: gridOf(ws) }));
ok(
  "sheets read",
  parsed.map((p) => p.name),
  ["Enquiry List", "Page 2", "Notes", "Scratch"]
);

const result = parseEnquirySheets(parsed);
const byName = new Map(result.rows.map((r) => [r.name, r]));

ok("every usable row landed", result.rows.length, PAGE1_ROWS + PAGE2_ROWS);
ok("every row has a name", result.rows.every((r) => r.name), true);

// The printed form's own headings, in order, with S.No left alone.
ok("the paper form's columns all recognised", result.mapping?.matched, [
  { label: "Name", header: "Name" },
  { label: "Phone", header: "Phone Number" },
  { label: "Sex", header: "Sex" },
  { label: "Date of Inquiry", header: "Date of Inquiry" },
  { label: "Note", header: "Note" },
]);
ok('"S.No" is not mistaken for a phone column', result.mapping?.ignored, ["S.No"]);
ok("nothing required is missing", result.mapping?.missing, []);

group("Per-sheet counts");
ok("sheet report", result.sheets, [
  { name: "Enquiry List", rows: PAGE1_ROWS },
  { name: "Page 2", rows: PAGE2_ROWS },
  { name: "Notes", rows: 0, skipped: "empty" },
  { name: "Scratch", rows: 0, skipped: "no recognisable column headers" },
]);

group("Rows that could not be imported");
ok(
  "only the row with real data and no name is reported",
  result.skippedNoName,
  1
);
ok(
  "the repeat is named, with the number that made it a repeat",
  result.duplicates,
  ["Ramesh Kumar (9876543210)"]
);

group("Rows imported despite a gap");
const walkIn = byName.get("Walk In");
ok("a walk-in with no number still imported", walkIn?.name, "Walk In");
ok("...with no phone rather than a blank string", walkIn?.phone, null);
ok("...and is counted, so the screen can say so", result.withoutPhone, 1);
ok("a missing inquiry date is left for the server to date", byName.get("No Date")?.inquiryDate, "");
ok(
  "an unreadable date is dropped, not passed through",
  byName.get("Garbage Date")?.inquiryDate,
  ""
);
ok("no note is no note", byName.get("No Date")?.note, null);

group("Dates and fields read off the form");
ok("day-first date read as 5 December", byName.get("Ramesh Kumar")?.inquiryDate, "2026-12-05");
ok("two-digit year read as 2026", byName.get("Sunita Devi")?.inquiryDate, "2026-10-07");
ok("the form's M and F read", [byName.get("Ramesh Kumar")?.sex, byName.get("Sunita Devi")?.sex], [
  "male",
  "female",
]);
ok("the NOTE column kept as written", byName.get("Ramesh Kumar")?.note, "Monday, Thursday");
ok("a number stored as a number still reads as the phone", byName.get("Ramesh Kumar")?.phone, "9876543210");
ok("the first of a repeated pair is the one kept", byName.get("Ramesh Kumar")?.inquiryDate, "2026-12-05");
ok("Page 2's own headings matched the same fields", byName.get("Anil Sharma"), {
  name: "Anil Sharma",
  phone: "+91 98765 43210",
  sex: "male",
  inquiryDate: "2024-10-01",
  note: "Tue, Fri",
});

// ===== 4. the CSV path, through the importer's own shift =====
group("A CSV read through the importer's shift");
const csvGrid = parseCSV("Name,Sex,Ph.No\nDeepa Rani,F,9811100022").map((r) => ["", ...r]);
const fromCsv = parseEnquirySheets([{ name: "enquiries.csv", grid: csvGrid }]);
ok("CSV columns line up after the shift", fromCsv.rows, [
  {
    name: "Deepa Rani",
    phone: "9811100022",
    sex: "female",
    inquiryDate: "",
    note: null,
  },
]);
ok("a CSV header row is found too", fromCsv.mapping?.matched.length, 3);

// ===== summary =====
console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`
);
process.exit(failures === 0 ? 0 : 1);
