import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as dates from "../src/lib/utils.ts";

// Compile the pure TypeScript helper with its real date utilities, without a
// browser or Next server. Node's native TS loader requires explicit extensions.
const source = readFileSync(new URL("../src/lib/dashboard-finance.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(() => dates, compiledModule, compiledModule.exports);
const { validReceivedDate, selectedDashboardCycle, dashboardCycles, dashboardHref, cycleTitle } = compiledModule.exports;
const today = "2026-11-21";

assert.equal(validReceivedDate("2026-11-13", today), true);
for (const value of ["2026-11-22", "2026-02-29", "2026-11-31", "13-11-2026", "", null, "2026-11-13T12:00:00Z"]) {
  assert.equal(validReceivedDate(value, today), false, `Reject ${value}`);
}
assert.equal(validReceivedDate("2024-02-29", today), true);
assert.equal(dates.gymCycle("2026-11-13").start, "2026-10-15");
assert.equal(dates.gymCycle("2026-11-14").start, "2026-10-15");
assert.equal(dates.gymCycle("2026-11-16").start, "2026-11-15");
assert.equal(selectedDashboardCycle("2026-10-15", today).end, "2026-11-14");
for (const invalid of [undefined, "2026-12-15", "2026-10-16", "bad", "2026-02-30"]) {
  assert.equal(selectedDashboardCycle(invalid, today).start, "2026-11-15");
}
assert.equal(dashboardCycles(today, "2026-10-15").length, 24);
assert.equal(dashboardCycles(today, "2024-01-15").at(-1).start, "2024-01-15");
assert.equal(cycleTitle(dates.gymCycle("2026-11-13")), "15 Oct → 14 Nov 2026");
assert.equal(cycleTitle(dates.gymCycle("2026-12-20")), "15 Dec 2026 → 14 Jan 2027");
assert.equal(dashboardHref("2026-10-15", "equipment", "Belt & repair", 2), "/admin?cycle=2026-10-15&type=equipment&q=Belt+%26+repair&page=2#transactions");
console.log("Dashboard finance: received-date validation, previous-cycle allocation, month selection and navigation passed.");
