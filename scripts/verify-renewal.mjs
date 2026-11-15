/**
 * Checks the dates used by both the admin renewal preview and the server.
 * Run with: node scripts/verify-renewal.mjs
 */
import assert from "node:assert/strict";
import { getMembershipRenewalDates, istDateString } from "../src/lib/utils.ts";

const today = "2026-11-15";
let checks = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log(`  ok    ${label}`);
}

check(
  "four days late, continued attendance counts from the previous due date",
  getMembershipRenewalDates("2026-11-11", 30, "due_date", today),
  { startDate: "2026-11-11", newExpiry: "2026-12-11" }
);
check(
  "four days late, returning after a break counts from payment day",
  getMembershipRenewalDates("2026-11-11", 30, "today", today),
  { startDate: today, newExpiry: "2026-12-15" }
);
check(
  "an omitted choice preserves renewal from today for an expired membership",
  getMembershipRenewalDates("2026-11-11", 30, undefined, today),
  { startDate: today, newExpiry: "2026-12-15" }
);

for (const choice of ["today", "due_date"]) {
  check(
    `active membership keeps the remaining days with ${choice}`,
    getMembershipRenewalDates("2026-11-20", 30, choice, today),
    { startDate: "2026-11-20", newExpiry: "2026-12-20" }
  );
  check(
    `membership due today has the same result with ${choice}`,
    getMembershipRenewalDates(today, 30, choice, today),
    { startDate: today, newExpiry: "2026-12-15" }
  );
}

for (const [days, expected] of [
  [90, "2027-02-09"],
  [180, "2027-05-10"],
  [365, "2027-11-11"],
]) {
  check(
    `${days}-day renewal extends from the old due date`,
    getMembershipRenewalDates("2026-11-11", days, "due_date", today).newExpiry,
    expected
  );
}

check(
  "a 30-day plan stays 30 days when starting at the end of January",
  getMembershipRenewalDates("2027-01-31", 30, "due_date", "2027-02-04").newExpiry,
  "2027-03-02"
);
check(
  "leap February is counted correctly",
  getMembershipRenewalDates("2028-02-27", 30, "due_date", "2028-03-02").newExpiry,
  "2028-03-28"
);
check(
  "continued attendance is not silently reset to today for a long overdue member",
  getMembershipRenewalDates("2026-09-01", 30, "due_date", today),
  { startDate: "2026-09-01", newExpiry: "2026-10-01" }
);

const first = getMembershipRenewalDates("2026-11-11", 30, "due_date", today);
check(
  "a subsequent renewal uses the latest due date and adds the full duration",
  getMembershipRenewalDates(first.newExpiry, 30, "due_date", today).newExpiry,
  "2027-01-10"
);

const justAfterMidnight = new Date("2026-11-14T18:31:00Z");
check(
  "the payment day after midnight in India is the new local date",
  istDateString(justAfterMidnight),
  today
);
check(
  "renewal from today uses the Indian calendar day",
  getMembershipRenewalDates("2026-11-11", 30, "today", istDateString(justAfterMidnight)),
  { startDate: today, newExpiry: "2026-12-15" }
);

console.log(`PASS — ${checks} renewal date checks`);
