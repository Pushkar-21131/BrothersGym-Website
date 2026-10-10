/**
 * Matching a member against what was typed into the search box. No React, so
 * `scripts/verify-member-search.mjs` can run this exact module and check that
 * "1" finds member 1 — which is the whole reason the scopes exist.
 */

export type SearchScope = "all" | "gymId" | "name" | "phone";

/**
 * What the search box is searching, in the order it appears.
 *
 * "all" is the default and the widest net, but it cannot be the only option: an
 * M.No, a name and a phone number are different kinds of value, and one box that
 * has to guess which was typed will guess wrong somewhere.
 */
export const SEARCH_SCOPES: {
  key: SearchScope;
  label: string;
  placeholder: string;
}[] = [
  { key: "all", label: "All", placeholder: "M.No, name or phone" },
  { key: "gymId", label: "M.No", placeholder: "e.g. 1295 or C-1295" },
  { key: "name", label: "Name", placeholder: "Name, in full or part" },
  { key: "phone", label: "Phone", placeholder: "Any part of the number" },
];

/** The fields the search reads. A subset of the admin row, so nothing here
 *  depends on the page that renders it — the inactive list selects fewer columns
 *  than the members list and searches through the same code. */
export type SearchableMember = {
  gymId: number;
  name: string;
  contactNumber: string;
  email?: string | null;
  address?: string | null;
  parentName?: string | null;
  branchName?: string | null;
};

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * The M.No the owner typed, or null if what he typed is not one.
 *
 * "C-1295" is how the register writes a cardio member and 1295 is what the row
 * holds, so both spellings have to reach the same member — the same reading
 * parseGymId() gives the import.
 */
export function gymIdWanted(q: string): number | null {
  const m = q.trim().match(/^c?\s*[-./]?\s*(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Six digits cannot be an M.No on any register this app holds, so a query that
 * long is allowed to be a phone number as well.
 */
const PHONE_DIGITS = 6;

/**
 * One member against one query.
 *
 * A bare number is read as an M.No and, below PHONE_DIGITS, as *only* an M.No.
 * Matching every field as a substring is what made the list unusable: "1" sits
 * inside almost every phone number and address on file, so typing it returned a
 * thousand rows instead of member 1. The Phone scope is how a partial number is
 * searched now that digits no longer mean "anything containing these digits".
 *
 * `hide` is the page's own hidden-fields check, passed in rather than imported so
 * this stays testable — a hidden column must not be searchable either, or the
 * search becomes a way to read it back.
 */
export function memberMatches(
  m: SearchableMember,
  q: string,
  scope: SearchScope,
  hide: (field: string) => boolean
): boolean {
  const wanted = gymIdWanted(q);

  if (scope === "gymId") return wanted !== null && m.gymId === wanted;
  if (scope === "name") return m.name.toLowerCase().includes(q);
  if (scope === "phone") {
    const digits = digitsOf(q);
    return digits.length > 0 && digitsOf(m.contactNumber).includes(digits);
  }

  const asPhone = digitsOf(q).length >= PHONE_DIGITS;
  if (wanted !== null && !asPhone) return m.gymId === wanted;

  return Boolean(
    (wanted !== null && m.gymId === wanted) ||
      (asPhone && digitsOf(m.contactNumber).includes(digitsOf(q))) ||
      m.name.toLowerCase().includes(q) ||
      (m.email && !hide("email") && m.email.toLowerCase().includes(q)) ||
      (m.address && !hide("address") && m.address.toLowerCase().includes(q)) ||
      (m.parentName && !hide("parentName") && m.parentName.toLowerCase().includes(q)) ||
      (m.branchName && m.branchName.toLowerCase().includes(q))
  );
}
