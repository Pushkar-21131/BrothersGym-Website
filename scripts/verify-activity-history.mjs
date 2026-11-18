import assert from "node:assert/strict";
import { activityChanges, getHistoryRange } from "../src/lib/activity-history.ts";
import { HISTORY_LIVE_AT, isHistoryEnabled } from "../src/lib/history-release.ts";

assert.equal(HISTORY_LIVE_AT, Date.parse("2026-11-19T12:00:00+05:30"));
assert.equal(isHistoryEnabled(HISTORY_LIVE_AT - 1), false);
assert.equal(isHistoryEnabled(HISTORY_LIVE_AT), true);
assert.equal(isHistoryEnabled(HISTORY_LIVE_AT + 1), true);

// The server may run in UTC. The day flips at 18:30 UTC, the week at Monday
// midnight IST, and month/year boundaries must not admit the previous period.
assert.equal(getHistoryRange("today", new Date("2026-11-18T18:29:59Z")).start.toISOString(), "2026-11-17T18:30:00.000Z");
assert.equal(getHistoryRange("today", new Date("2026-11-18T18:30:00Z")).start.toISOString(), "2026-11-18T18:30:00.000Z");
assert.equal(getHistoryRange("week", new Date("2026-11-22T18:29:59Z")).start.toISOString(), "2026-11-15T18:30:00.000Z");
assert.equal(getHistoryRange("week", new Date("2026-11-22T18:30:00Z")).start.toISOString(), "2026-11-22T18:30:00.000Z");
assert.equal(getHistoryRange("month", new Date("2026-12-31T18:30:00Z")).start.toISOString(), "2026-12-31T18:30:00.000Z");
assert.equal(getHistoryRange("all", new Date("2026-11-18T12:00:00Z")).start.toISOString(), "2026-10-18T12:00:00.000Z");
assert.equal(getHistoryRange("all", new Date("2026-03-01T00:00:00Z")).start.toISOString(), "2026-01-29T00:00:00.000Z");

// Hidden fields are omitted from an update, and must never show a fake change.
const changes = activityChanges(
  { name: "Rahul", contactNumber: "9000000000", feeAmount: 1200, email: "old@example.com", gender: null, passwordHash: "old hash", photoImage: "old photo" },
  { name: "Rahul", contactNumber: "9111111111", gender: "male", passwordHash: "new hash", photoImage: "new photo" },
);
assert.deepEqual(changes.map((c) => c.field), ["contactNumber", "gender"]);
assert.equal(changes[0].before, "9000000000");
assert.equal(changes[0].after, "9111111111");
assert.equal(changes[1].before, "Not recorded");
assert.deepEqual(activityChanges({ feeAmount: 1200 }, { feeAmount: 1200 }), []);
assert.deepEqual(activityChanges({ equipmentName: "Bench", cost: 1000 }, { equipmentName: "Bench", cost: 1500 })[0],
  { field: "cost", label: "Cost", before: "₹1,000", after: "₹1,500" });

console.log("Activity history: scheduled noon IST activation, date boundaries, rolling retention, real changes and excluded fields passed.");
