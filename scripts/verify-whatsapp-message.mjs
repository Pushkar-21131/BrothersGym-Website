/**
 * Checks the WhatsApp message builders. These strings go to a real member's
 * phone, from the owner's own number, and nothing downstream validates them —
 * a blank due date that renders as "valid till **" is only ever seen by the
 * customer. Node 24 strips the types natively; whatsapp.ts has no imports.
 *
 *   node scripts/verify-whatsapp-message.mjs
 */

import {
  generateEnquiryMessage,
  buildMemberUpdateMessage,
  buildWhatsAppLink,
  normalizePhone,
  hasDialablePhone,
} from "../src/lib/whatsapp.ts";

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

function has(label, text, needle) {
  checks++;
  if (text.includes(needle)) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          looked for ${JSON.stringify(needle)}\n          in         ${JSON.stringify(text)}`);
  }
}

function lacks(label, text, needle) {
  checks++;
  if (!text.includes(needle)) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} — found ${JSON.stringify(needle)}\n          in ${JSON.stringify(text)}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

const CHANGE = (field, label, from, to) => ({ field, label, from, to });

// ===== 1. the number the message is addressed to =====
group("Phone numbers");
ok("10 digits get the country code", normalizePhone("9876543210"), "919876543210");
ok("already-prefixed is left alone", normalizePhone("919876543210"), "919876543210");
ok("a 10-digit number starting 91 is still prefixed", normalizePhone("9112345678"), "919112345678");
ok("spaces and dashes are stripped", normalizePhone("+91 98765-43210"), "919876543210");
ok("a blank number has nothing to dial", hasDialablePhone(""), false);
ok("null has nothing to dial", hasDialablePhone(null), false);
ok("a 9-digit number is not dialable", hasDialablePhone("987654321"), false);
ok("a 10-digit number is", hasDialablePhone("9876543210"), true);

// ===== 2. what goes in the box =====
group("The message in the link");
const link = buildWhatsAppLink("9876543210", "Hi Ramesh!\nHow are you?");
ok("the link opens the member's chat", link.startsWith("https://wa.me/919876543210?text="), true);
ok("...with the message", decodeURIComponent(link.split("text=")[1]), "Hi Ramesh!\nHow are you?");
has("a newline is encoded, not left raw", link, "%0A");

// ===== 3. member update messages =====
group("An update that changed the fees and the due date");
const updated = buildMemberUpdateMessage({
  name: "Ramesh Kumar",
  gymId: 412,
  changes: [
    CHANGE("feeAmount", "Fees", "₹800", "₹600"),
    CHANGE("membershipExpiry", "Due Date", "4 Nov 2026", "4 Nov 2027"),
  ],
  expiry: "2027-11-04",
  feeAmount: 600,
});
has("greeted by name", updated, "Hi Ramesh Kumar!");
has("the member id is quoted, so the wrong person is spotted", updated, "ID #412");
has("the fee change reads old → new", updated, "• Fees: ₹800 → ₹600");
has("the date change reads old → new", updated, "• Due Date: 4 Nov 2026 → 4 Nov 2027");
has("the new due date is stated plainly", updated, "valid till *4 Nov 2027*");

group("The standing button: no changes, just the current details");
const current = buildMemberUpdateMessage({
  name: "Sunita",
  gymId: 9,
  changes: [],
  expiry: "2026-12-05",
  feeAmount: 500,
  planType: "full",
});
has("the due date is stated", current, "• Due Date: *5 Dec 2026*");
has("the fee is stated", current, "• Fees: ₹500");
has("the plan is spelled out, not the column value", current, "• Plan: Cardio");
lacks("nothing is announced as updated", current, "We've updated");
has("the member can reply to correct it", current, "just reply to this message");

group("A member with no due date on file");
// The import deliberately accepts a member with no due date, and the standing
// button is one tap away on every row. This is the string that used to reach
// the member as "valid till **".
const noDate = buildMemberUpdateMessage({
  name: "Walk In",
  gymId: 77,
  changes: [],
  expiry: "",
  feeAmount: 0,
});
lacks("no empty emphasis is left in the message", noDate, "**");
lacks("nor an empty date line", noDate, "* *");
has("it says the date is not recorded instead", noDate, "• Due Date: not recorded yet");
lacks("and no Rs 0 fee is quoted", noDate, "Fees");

group("A due date that appeared where there was none");
const gained = buildMemberUpdateMessage({
  name: "Walk In",
  gymId: 77,
  changes: [CHANGE("membershipExpiry", "Due Date", "not recorded", "4 Nov 2027")],
  expiry: "2027-11-04",
});
has("the blank side reads as words", gained, "• Due Date: not recorded → 4 Nov 2027");
has("the new date is stated plainly", gained, "valid till *4 Nov 2027*");

group("A blank due date after an edit");
const lostDate = buildMemberUpdateMessage({
  name: "Walk In",
  gymId: 77,
  changes: [CHANGE("name", "Name", "Walk In", "Ravi")],
  expiry: "",
});
lacks("the message does not promise a date it does not have", lostDate, "valid till");
has("it still says something true", lostDate, "have been updated");

group("The owner's own note is appended, not substituted");
const noted = buildMemberUpdateMessage({
  name: "Ramesh",
  gymId: 1,
  changes: [],
  expiry: "2026-12-05",
  customNote: "  Please bring the old receipt.  ",
});
has("the note is kept", noted, "Please bring the old receipt.");
ok(
  "...after the details",
  noted.indexOf("Please bring the old receipt.") > noted.indexOf("Due Date"),
  true
);
ok("...trimmed", noted.endsWith("Please bring the old receipt."), true);
const untrimmed = buildMemberUpdateMessage({
  name: "Ramesh",
  gymId: 1,
  changes: [],
  expiry: "2026-12-05",
});
ok("an empty note adds nothing", untrimmed.endsWith("Brothers Gym Team"), true);

// ===== 4. enquiry follow-ups =====
group("Enquiry follow-ups");
for (const id of ["gentle", "join_now", "hindi"]) {
  const text = generateEnquiryMessage(id, { name: "Anil Sharma" });
  has(`${id} addresses the person by name`, text, "Anil Sharma");
  has(`${id} signs off as the gym`, text, "Brothers Gym");
}
has("the gentle one is a check-in, not a demand", generateEnquiryMessage("gentle", { name: "A" }), "still thinking");
has("the Hindi one is actually in Hindi", generateEnquiryMessage("hindi", { name: "A" }), "नमस्ते");

// ===== summary =====
console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks`
);
process.exit(failures === 0 ? 0 : 1);
