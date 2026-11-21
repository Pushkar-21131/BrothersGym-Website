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
const { validReceivedDate, dashboardPeriodError, selectedDashboardPeriod, periodTitle, scheduledSalaryInPeriod, dashboardHref, dashboardSummaryHref } = compiledModule.exports;
const today = "2026-11-21";

assert.equal(validReceivedDate("2026-11-13", today), true);
for (const value of ["2026-11-22", "2026-02-29", "2026-11-31", "0000-01-01", "13-11-2026", "", null, "2026-11-13T12:00:00Z"]) {
  assert.equal(validReceivedDate(value, today), false, `Reject ${value}`);
}
assert.equal(validReceivedDate("2024-02-29", today), true);
assert.equal(dates.gymCycle("2026-11-13").start, "2026-10-15");
assert.equal(dates.gymCycle("2026-11-14").start, "2026-10-15");
assert.equal(dates.gymCycle("2026-11-16").start, "2026-11-15");
assert.deepEqual(selectedDashboardPeriod(undefined, undefined, today).period, { start: "2026-11-15", end: "2026-12-14" });
assert.deepEqual(selectedDashboardPeriod(undefined, undefined, today, "2026-10-15").period, { start: "2026-10-15", end: "2026-11-14" });
const range = { start: "2026-11-01", end: "2026-11-21" };
assert.deepEqual(selectedDashboardPeriod(range.start, range.end, today), { period: range, error: null });
assert.equal(dashboardPeriodError("2026-11-01", "2026-12-31", today), null);
for (const [start, end] of [["2026-11-22", "2026-12-01"], ["2026-11-20", "2026-11-19"], ["bad", "2026-11-21"], ["2026-11-01", "2026-02-30"], ["2026-11-01", undefined]]) {
  assert.ok(dashboardPeriodError(start, end, today));
  assert.equal(selectedDashboardPeriod(start, end, today).period.start, "2026-11-15");
}
assert.equal(periodTitle({ start: "2026-11-13", end: "2026-11-13" }), "13 Nov 2026");
assert.equal(periodTitle(range), "1 Nov 2026 – 21 Nov 2026");
assert.equal(dashboardHref(range, "equipment", "Belt & repair", 2), "/admin?from=2026-11-01&to=2026-11-21&review=1&type=equipment&q=Belt+%26+repair&page=2#transactions");
assert.equal(dashboardSummaryHref(range), "/admin?from=2026-11-01&to=2026-11-21");
assert.equal(scheduledSalaryInPeriod("2025-01-10", 1500, range, today), 1500);
assert.equal(scheduledSalaryInPeriod("2025-01-10", 1500, { start: "2026-11-15", end: "2026-12-14" }, today), 0);
assert.equal(scheduledSalaryInPeriod("2025-01-20", 1500, { start: "2026-10-01", end: "2026-11-30" }, today), 3000);
assert.equal(scheduledSalaryInPeriod("2026-11-20", 1500, { start: "2026-10-01", end: "2026-11-30" }, today), 1500);
assert.equal(scheduledSalaryInPeriod("2026-11-22", 1500, range, today), 0);
assert.equal(scheduledSalaryInPeriod("2025-01-20", 1500, { start: "2026-11-20", end: "2026-11-20" }, today), 1500);
assert.equal(scheduledSalaryInPeriod("2025-01-20", 1500, { start: "2026-11-19", end: "2026-11-19" }, today), 0);
assert.equal(scheduledSalaryInPeriod("2024-01-31", 1000, { start: "2024-02-29", end: "2024-02-29" }, today), 1000);
assert.equal(scheduledSalaryInPeriod("2024-01-31", 1000, { start: "2025-02-28", end: "2025-03-31" }, today), 2000);
console.log("Dashboard finance: custom date ranges, inclusive/multiple paydays, leap years, future cutoffs, legacy links and review/close URLs passed.");
