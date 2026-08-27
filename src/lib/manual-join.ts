/**
 * Pure helpers for the manual UPI join flow.
 *
 * Deliberately NOT a "use server" module — these are called from server actions,
 * server components and are side-effect free. Nothing here touches the database
 * or the network, so it can be reused freely on either side.
 */

/**
 * The human-readable reference shown to the member and printed on the admin row:
 * `BG-<branchCode>-<zero-padded id>`, e.g. `BG-NR-000123`.
 *
 * Derived from the join id — never stored — so there is no extra column and no
 * second write. The id is authoritative; the branch code and padding are only to
 * make it readable and typo-resistant.
 */
export function deriveJoinReference(branchCode: string, joinId: number): string {
  const code = (branchCode || "BG").toUpperCase();
  return `BG-${code}-${String(joinId).padStart(6, "0")}`;
}

/**
 * Parse a reference the member typed on the status page back into its parts.
 *
 * Tolerant of case, surrounding spaces and a missing `BG-` prefix. It only
 * LOCATES the row (by id); the caller must still re-check the branch code and the
 * phone number against the stored row, so a typo that happens to hit a real id
 * can never read back someone else's request.
 */
export function parseJoinReference(
  raw: string
): { branchCode: string; joinId: number } | null {
  const cleaned = (raw || "").trim().toUpperCase().replace(/\s+/g, "");
  // [BG-]<letters>-<digits>, the leading BG- optional.
  const m = cleaned.match(/^(?:BG-)?([A-Z]{1,6})-?(\d{1,9})$/);
  if (!m) return null;
  const joinId = parseInt(m[2], 10);
  if (!joinId) return null;
  return { branchCode: m[1], joinId };
}

/**
 * Build the `upi://pay` deep-link / QR payload.
 *
 * `pa` is the payee VPA, `pn` the payee name the UPI app shows before the payer
 * confirms, `am` locks the amount, `tn` is a free-text note carrying our
 * reference so the transfer is traceable. We deliberately do NOT set `tr`
 * (merchant transaction ref): several UPI apps validate it and reject the whole
 * intent when it isn't a registered merchant ref, whereas `tn` is always free
 * text.
 */
export function buildUpiPayString(opts: {
  upiId: string;
  payeeName: string;
  amount: number;
  note?: string;
}): string {
  const params = new URLSearchParams();
  params.set("pa", opts.upiId);
  params.set("pn", opts.payeeName);
  params.set("am", opts.amount.toFixed(2));
  params.set("cu", "INR");
  if (opts.note) params.set("tn", opts.note);
  // URLSearchParams encodes spaces as "+"; UPI apps are happier with %20.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Format a `yyyy-mm-dd` (or full ISO) date as "DD Mon YYYY" in IST.
 *
 * A bare date string parses as UTC midnight; pinning it to IST midnight first
 * keeps the calendar day correct whatever timezone the server runs in. Returns
 * the input unchanged if it isn't a parseable date.
 */
export function formatDayIST(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(
    dateStr.length <= 10 ? `${dateStr}T00:00:00+05:30` : dateStr
  );
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
