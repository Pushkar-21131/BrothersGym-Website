/**
 * Checks the gym's 15th → 14th cycle against dates with known answers.
 *
 *   node scripts/verify-cycle.mjs
 *
 * The complaint this exists for: every money figure on the dashboard was a
 * lifetime total under an "All Time" label, and the owner counts a month from
 * the 15th to the 14th. Imports the real src/lib/utils.ts, so it cannot drift
 * from what the dashboard runs.
 *
 * The cases that matter are the two days either side of the boundary — the 15th
 * and the 14th — and the months whose length is not a constant, because the end
 * date is derived rather than written down as "the 14th".
 */

import { gymCycle, addMonthsIso, CYCLE_START_DAY } from "../src/lib/utils.ts";

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

const range = (start) => {
  const c = gymCycle(start);
  return [c.start, c.end, c.label];
};

group("The cycle the owner is in");
ok("the 15th opens it", range("2026-10-15")[0], "2026-10-15");
ok("mid-month is inside it", range("2026-10-20")[1], "2026-11-14");
ok("the 14th still belongs to the cycle that opened last month", range("2026-10-14")[0], "2026-09-15");
ok("the day after, the 15th, opens the next one", range("2026-10-15")[0], "2026-10-15");
ok("day 3 sits two thirds into the previous cycle", range("2026-10-03")[0], "2026-09-15");
ok("day 1 too", range("2026-11-01")[0], "2026-10-15");

group("Months of every length");
// The end is "next cycle minus a day", so these are the cases a hardcoded 14th
// would still get right — kept to pin the arithmetic rather than to test it.
ok("31-day month", range("2026-01-20"), ["2026-01-15", "2026-02-14", "15 Jan → 14 Feb"]);
ok("30-day month", range("2026-04-20"), ["2026-04-15", "2026-05-14", "15 Apr → 14 May"]);
ok("February", range("2027-02-20"), ["2027-02-15", "2027-03-14", "15 Feb → 14 Mar"]);
ok("leap February", range("2028-02-20"), ["2028-02-15", "2028-03-14", "15 Feb → 14 Mar"]);
ok("the cycle that contains 29 Feb", range("2028-02-01"), ["2028-01-15", "2028-02-14", "15 Jan → 14 Feb"]);

group("The label");
ok("no year when the cycle sits inside one", gymCycle("2026-10-20").label, "15 Oct → 14 Nov");
ok("both years when it straddles New Year", gymCycle("2026-12-20").label, "15 Dec 2026 → 14 Jan 2027");
ok("the straddling one starts in December", range("2026-12-20")[0], "2026-12-15");
ok("...and ends in January", range("2026-12-20")[1], "2027-01-14");
ok("January the 3rd is still in the straddling cycle", range("2027-01-03")[0], "2026-12-15");
ok("the 15th of that January opens a fresh one", gymCycle("2027-01-15").label, "15 Jan → 14 Feb");

group("Every day of three years lands in exactly one cycle");
// The invariant the whole page rests on: the range a day reports contains that
// day, the cycle is 28–31 days long, and the next cycle begins the day after
// this one ends — no gap, no overlap, no short cycle.
const bad = [];
let cursor = "2026-01-01";
for (let i = 0; i < 365 * 3; i++) {
  const c = gymCycle(cursor);
  if (!(c.start <= cursor && cursor <= c.end)) bad.push([cursor, "not inside"]);
  if (c.start.slice(8) !== String(CYCLE_START_DAY).padStart(2, "0")) bad.push([cursor, "wrong start day"]);
  if (c.end.slice(8) !== "14") bad.push([cursor, "wrong end day"]);
  if (gymCycle(shiftDay(c.end)).start !== addMonthsIso(c.start, 1)) bad.push([cursor, "cycles not contiguous"]);
  const days = (Date.parse(`${c.end}T00:00:00Z`) - Date.parse(`${c.start}T00:00:00Z`)) / 86400000 + 1;
  if (days < 28 || days > 31) bad.push([cursor, `length ${days}`]);
  cursor = shiftDay(cursor);
}
ok("no day fails the invariant", bad.slice(0, 5), []);

function shiftDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

group("Stepping a cycle at a time");
ok("back one", addMonthsIso("2026-10-15", -1), "2026-09-15");
ok("forward one", addMonthsIso("2026-10-15", 1), "2026-11-15");
ok("back across January", addMonthsIso("2027-01-15", -1), "2026-12-15");
ok("forward across December", addMonthsIso("2026-12-15", 1), "2027-01-15");
ok("a year", addMonthsIso("2026-10-15", 12), "2027-10-15");

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
