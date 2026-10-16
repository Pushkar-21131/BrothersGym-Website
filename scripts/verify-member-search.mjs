/**
 * Checks the members list search against rows with known answers.
 *
 *   node scripts/verify-member-search.mjs
 *
 * The complaint this exists for: typing "1" returned almost the whole book,
 * because every phone number and address on file contains a 1. Imports the real
 * src/lib/member-search.ts, so it cannot drift from what the page runs.
 */

import {
  memberMatches,
  gymIdWanted,
  SEARCH_SCOPES,
} from "../src/lib/member-search.ts";

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

const hideNothing = () => false;

const member = (over = {}) => ({
  gymId: 1,
  name: "Ravi Kumar",
  email: null,
  contactNumber: "9811234567",
  address: null,
  parentName: null,
  branchName: "Nangal Raya",
  ...over,
});

/** Who a query turns up, by M.No, for the book below. */
const BOOK = [
  member({ gymId: 1, name: "Ravi Kumar", contactNumber: "9811234567" }),
  member({ gymId: 10, name: "Sunil Yadav", contactNumber: "9876500011" }),
  member({ gymId: 11, name: "Anita Sharma", contactNumber: "9910022345" }),
  member({ gymId: 100, name: "Mohit Verma", contactNumber: "9000011122" }),
  // The two the screenshot was about: one is cardio, one is not, and the C is
  // how the register spells the first one's number.
  member({ gymId: 1295, name: "Pooja Rani", contactNumber: "9899998888" }),
  member({
    gymId: 1296,
    name: "Deepak Singh",
    contactNumber: "9899997777",
    address: "H-1/1296, Nangal Raya",
  }),
];

const find = (q, scope = "all", hide = hideNothing) =>
  BOOK.filter((m) => memberMatches(m, q.toLowerCase().trim(), scope, hide)).map(
    (m) => m.gymId
  );

group("A number typed into the default scope is an M.No, and only an M.No");
ok('"1" finds member 1 alone', find("1"), [1]);
ok('"10" finds member 10 alone', find("10"), [10]);
ok('"100" finds member 100 alone', find("100"), [100]);
ok('"1295"', find("1295"), [1295]);
ok(
  "an address containing the typed digits is not a match",
  find("1").includes(1296),
  false
);
ok(
  "and neither is a phone number containing them",
  find("999").length,
  0
);

group("The register's C spelling reaches the same member");
ok('"C-1295"', find("C-1295"), [1295]);
ok('"c1295"', find("c1295"), [1295]);
ok('"C 1295"', find("C 1295"), [1295]);
ok("in the M.No scope too", find("C-1295", "gymId"), [1295]);

group("A name is still a name");
ok('"ravi"', find("ravi"), [1]);
ok('"rani"', find("rani"), [1295]);
ok('"KUMAR" in caps', find("KUMAR"), [1]);
ok(
  "a name is not found when the M.No scope was asked for",
  find("ravi", "gymId"),
  []
);

group("A phone number is searched as digits, and only in its own scope");
ok(
  "a full number, in the default scope",
  find("9811234567"),
  [1]
);
ok("a partial number, in the Phone scope", find("22345", "phone"), [11]);
ok(
  "a partial that two members share finds both",
  find("2345", "phone"),
  [1, 11]
);
ok("spaces and dashes in the typed number are ignored", find("981-1234", "phone"), [1]);
ok("the last four digits", find("8888", "phone"), [1295]);
ok(
  "a 4-digit tail is not treated as an M.No by the Phone scope",
  find("8888", "gymId"),
  []
);
ok(
  "and the Phone scope does not reach names",
  find("ravi", "phone"),
  []
);

group("The Name scope searches names only");
ok("a name matches", find("sharma", "name"), [11]);
ok("an address does not", find("Nangal", "name"), []);
ok("nor a phone number", find("9811", "name"), []);

group("Hidden columns are not searchable");
ok(
  "the same address, searched by text, when hidden",
  find("H-1/1296", "all", (f) => f === "address"),
  []
);
ok(
  "and when not hidden",
  find("H-1/1296", "all"),
  [1296]
);
ok(
  "a hidden email is not reachable",
  BOOK.filter((m) =>
    memberMatches(
      { ...m, email: "ravi@example.com" },
      "ravi@example",
      "all",
      (f) => f === "email"
    )
  ).length,
  0
);

// The page blanks the column before it reaches the client, so this is the second
// layer rather than the only one — but a blank cell and a hidden cell have to be
// the same thing to the search, or one of the two paths reads the number back.
group("A hidden phone number is not searchable either");
const hidePhone = (f) => f === "contactNumber";
ok("a full number, in the default scope", find("9811234567", "all", hidePhone), []);
ok("a partial number, in the Phone scope", find("22345", "phone", hidePhone), []);
ok("a 10-digit query is not rescued by another field", find("9811", "phone", hidePhone), []);
ok(
  "and the same two queries still work when it is not hidden",
  [find("9811234567")[0], find("22345", "phone")[0]],
  [1, 11]
);
ok("an M.No is still findable", find("1295", "all", hidePhone), [1295]);
ok("and so is a name", find("ravi", "all", hidePhone), [1]);

group("gymIdWanted() itself");
ok('"1"', gymIdWanted("1"), 1);
ok('"C-1295"', gymIdWanted("C-1295"), 1295);
ok('"c.1295"', gymIdWanted("c.1295"), 1295);
ok('"1295C" is not a leading-C form', gymIdWanted("1295C"), null);
ok('"ravi"', gymIdWanted("ravi"), null);
ok('""', gymIdWanted(""), null);

group("The scopes the row renders");
ok(
  "four of them, starting at All",
  SEARCH_SCOPES.map((s) => s.key),
  ["all", "gymId", "name", "phone"]
);
ok(
  "each carries the placeholder that explains it",
  SEARCH_SCOPES.every((s) => s.placeholder.length > 0),
  true
);

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`
);
process.exit(failures === 0 ? 0 : 1);
