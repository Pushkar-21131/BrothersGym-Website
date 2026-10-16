/**
 * Checks the permission sanitiser — the one gate every permission write passes.
 *
 *   node scripts/verify-permissions.mjs
 *
 * The rule under test: View is implied by any other granted action, EXCEPT in a
 * module flagged `allowAddOnly`, where View means "sees every row" and an
 * account without it reaches only the rows it wrote. Get that backwards and
 * either the owner's notepad config is silently rewritten on save, or a staff
 * account that can edit ends up locked out of every page.
 *
 * Imports the real src/lib/permissions.ts, so it cannot drift from what the
 * server runs.
 */

import {
  sanitizeStaffPermissions,
  PERMISSION_MODULES,
} from "../src/lib/permissions.ts";

let failures = 0;
let checks = 0;

/** Key order is the sanitiser's, not the caller's, so the comparison must not
 *  be able to fail on it — only on which keys hold which values. */
const canon = (v) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val
  );

function ok(label, actual, expected) {
  checks++;
  const a = canon(actual);
  const e = canon(expected);
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

const clean = (input) => sanitizeStaffPermissions(input);

// ── which modules opt in ───────────────────────────────────────────────────
group("The modules that can be used add-only");
ok(
  "exactly enquiries and equipment are flagged",
  PERMISSION_MODULES.filter((m) => m.allowAddOnly).map((m) => m.key),
  ["enquiries", "equipment"]
);
ok(
  "the members register is not one of them",
  PERMISSION_MODULES.find((m) => m.key === "members")?.allowAddOnly,
  undefined
);

// ── View is implied everywhere else ────────────────────────────────────────
group("A normal module: any action still drags View on with it");
ok(
  "members canAdd without canView",
  clean({ members: { canAdd: true, canView: false } }),
  { members: { canAdd: true, canView: true } }
);
ok(
  "members canEdit without canView",
  clean({ members: { canEdit: true, canView: false } }),
  { members: { canEdit: true, canView: true } }
);
ok(
  "reminders canSendSMS without canView",
  clean({ reminders: { canSendSMS: true, canView: false } }),
  { reminders: { canSendSMS: true, canView: true } }
);
ok(
  "a module with nothing granted stays off",
  clean({ members: { canView: false } }),
  { members: { canView: false } }
);

// ── An add-only module keeps the split ─────────────────────────────────────
group("An add-only module: View stays off when it was set off");
ok(
  "enquiries canAdd without canView survives",
  clean({ enquiries: { canAdd: true, canView: false } }),
  { enquiries: { canAdd: true, canView: false } }
);
ok(
  "equipment canAdd without canView survives",
  clean({ equipment: { canAdd: true, canView: false } }),
  { equipment: { canAdd: true, canView: false } }
);
ok(
  "enquiries canEdit without canView survives — that means edit my own",
  clean({ enquiries: { canEdit: true, canView: false } }),
  { enquiries: { canEdit: true, canView: false } }
);
ok(
  "enquiries canDelete without canView survives too",
  clean({ enquiries: { canDelete: true, canView: false } }),
  { enquiries: { canDelete: true, canView: false } }
);
ok(
  "and the full list is still available when View IS granted",
  clean({ enquiries: { canView: true, canAdd: true } }),
  { enquiries: { canView: true, canAdd: true } }
);
ok(
  "canView absent entirely is the same as false",
  clean({ enquiries: { canAdd: true } }),
  { enquiries: { canAdd: true } }
);

// ── What a malformed blob does ─────────────────────────────────────────────
group("Rubbish in the column");
ok("a string", clean("nope"), {});
ok("null", clean(null), {});
ok("an array", clean([]), {});
ok("a module that is not an object", clean({ members: "all" }), {});
ok(
  "an action that is not a boolean is dropped, not coerced",
  clean({ members: { canView: "yes", canEdit: true } }),
  { members: { canEdit: true, canView: true } }
);
ok(
  "a module key that does not exist is dropped",
  clean({ payroll: { canView: true } }),
  {}
);
ok(
  "an action key that does not exist is dropped",
  clean({ members: { canView: true, canFly: true } }),
  { members: { canView: true } }
);
ok(
  "a module that contributes nothing valid is omitted, not written empty",
  clean({ members: { canManage: true } }),
  {}
);

// ── hiddenFields ───────────────────────────────────────────────────────────
group("Hidden fields");
ok(
  "kept when the field is declared",
  clean({ members: { canView: true, hiddenFields: ["contactNumber"] } }),
  { members: { canView: true, hiddenFields: ["contactNumber"] } }
);
ok(
  "an undeclared field is dropped",
  clean({ members: { canView: true, hiddenFields: ["salary"] } }),
  { members: { canView: true, hiddenFields: [] } }
);
ok(
  "repeats collapse",
  clean({ members: { canView: true, hiddenFields: ["email", "email"] } }),
  { members: { canView: true, hiddenFields: ["email"] } }
);
ok(
  "a non-array is ignored rather than stored",
  clean({ members: { canView: true, hiddenFields: "email" } }),
  { members: { canView: true } }
);
ok(
  "a module with no hideable fields never gets the key",
  clean({ reminders: { canView: true, hiddenFields: ["phone"] } }),
  { reminders: { canView: true } }
);

console.log(
  failures === 0
    ? `\nPASS — ${checks}/${checks} checks`
    : `\nFAIL — ${failures} of ${checks} checks failed`
);
process.exitCode = failures === 0 ? 0 : 1;
