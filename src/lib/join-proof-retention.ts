/**
 * Retention sweep for payment screenshots on join requests.
 *
 * WHY THIS EXISTS
 * A proof is base64 in the online_joins row, which stores at 4/3 of the image —
 * roughly 53–120KB each against a 0.5GB Neon allowance shared with every other
 * table. Nothing reclaims that on its own, and a gym accumulates join requests
 * forever, so without a rule the column only ever grows.
 *
 * THE RULES
 *   rejected          → screenshot kept 10 days from the rejection, then swept.
 *   pending/claimed   → the owner never decided. Screenshot swept 60 days after
 *                       the last upload; the request row itself is left alone.
 *   paid              → kept indefinitely. A confirmed payment is a record the
 *                       owner may want, so clearing it is their call by hand
 *                       (deleteJoinProof), never a sweep's.
 *
 * The undecided window is long and the row survives it because a sweep must not
 * make the owner's decision for them. Auto-rejecting at 60 days would mail a
 * member that they were turned down based on nothing but a clock. So the request
 * stays in the queue, and only the bytes go.
 *
 * DELIBERATELY NOT "use server"
 * This is called from the admin join-requests page during render. In a "use
 * server" module every export becomes a public endpoint, and a sweep that anyone
 * could trigger is not something to hand out — same reasoning as join-proof.ts.
 *
 * WHY NO CRON
 * Vercel's free tier gives daily cron at best, and this needs no schedule of its
 * own: the only person who cares about these rows is the owner, and the owner
 * lands on the join-requests page. Piggybacking on that load means the sweep runs
 * exactly when someone is looking, costs one UPDATE that usually matches zero
 * rows, and needs no new infrastructure.
 */

import { db } from "@/db";
import { onlineJoins } from "@/db/schema";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

/** Days a rejected request's screenshot survives after the rejection. */
export const REJECTED_PROOF_RETENTION_DAYS = 10;

/**
 * Days an undecided request's screenshot survives after its last upload.
 *
 * Deliberately far longer than the rejected window: a rejection is a decision,
 * so its 10 days are just an argument buffer, whereas an untouched request may
 * only mean the owner was away. 60 days is long enough that nobody loses
 * evidence they were still working through.
 */
export const ABANDONED_PROOF_RETENTION_DAYS = 60;

/**
 * Only warn about an upcoming sweep once it is this close.
 *
 * Without it, every freshly submitted request would carry a "deletes in 59 days"
 * note — noise that trains the owner to ignore the line that matters. The
 * rejected window is shorter than this, so those always show a countdown.
 */
const PROOF_SWEEP_WARN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses where the owner has not yet decided, so the row must outlive its image. */
const UNDECIDED = ["pending", "claimed"] as const;

/**
 * How many days remain before this request's screenshot is swept, or null if
 * there is nothing worth telling the owner — no image, no rule that applies
 * (confirmed payments are kept), or a deadline still further off than
 * PROOF_SWEEP_WARN_DAYS.
 *
 * Shared with the admin page so the countdown the owner reads and the cutoff the
 * sweep applies can't drift apart.
 */
export function daysUntilProofSweep(args: {
  status: string;
  hasImage: boolean;
  rejectedAt: Date | null;
  proofUploadedAt: Date | null;
}): number | null {
  if (!args.hasImage) return null;

  let basis: Date | null = null;
  let window = 0;

  if (args.status === "rejected") {
    // rejectedAt is null on rows rejected before that column existed; their
    // upload time is the closest thing to a decision time we have.
    basis = args.rejectedAt ?? args.proofUploadedAt;
    window = REJECTED_PROOF_RETENTION_DAYS;
  } else if ((UNDECIDED as readonly string[]).includes(args.status)) {
    // proofUploadedAt is re-stamped when a member replaces a blurry shot, which
    // is what we want: the clock should run from the newest evidence, not the
    // first attempt.
    basis = args.proofUploadedAt;
    window = ABANDONED_PROOF_RETENTION_DAYS;
  } else {
    return null;
  }

  if (!basis) return null;

  const deadline = basis.getTime() + window * DAY_MS;
  const days = Math.max(0, Math.ceil((deadline - Date.now()) / DAY_MS));
  return days > PROOF_SWEEP_WARN_DAYS ? null : days;
}

/**
 * Clear the image bytes from every request past its retention window.
 *
 * Returns how many rows were cleared. Never throws: this runs as a side errand
 * during a page render, and failing to reclaim some space is not a reason to show
 * the owner an error page instead of their join requests.
 */
export async function sweepExpiredJoinProofs(): Promise<number> {
  const rejectedCutoff = new Date(
    Date.now() - REJECTED_PROOF_RETENTION_DAYS * DAY_MS
  );
  const abandonedCutoff = new Date(
    Date.now() - ABANDONED_PROOF_RETENTION_DAYS * DAY_MS
  );

  try {
    const cleared = await db
      .update(onlineJoins)
      // proofUploadedAt is untouched on purpose — it is the audit trail that a
      // screenshot was submitted, and it has to outlive the bytes.
      .set({ proofImage: null, proofMime: null })
      .where(
        and(
          // Keeps the sweep a no-op once everything eligible is already cleared,
          // instead of rewriting the same rows on every admin page load. Both
          // rules need it, so it is hoisted out of the OR.
          isNotNull(onlineJoins.proofImage),
          or(
            and(
              eq(onlineJoins.status, "rejected"),
              // coalesce so rows predating rejectedAt still age out, rather than
              // sitting there forever because the basis column is null.
              sql`coalesce(${onlineJoins.rejectedAt}, ${onlineJoins.proofUploadedAt}) < ${rejectedCutoff}`
            ),
            and(
              inArray(onlineJoins.status, [...UNDECIDED]),
              // claimedAt/createdAt are fallbacks for a hand-edited row only:
              // proofImage and proofUploadedAt are always written together, so in
              // practice the first term always wins.
              sql`coalesce(${onlineJoins.proofUploadedAt}, ${onlineJoins.claimedAt}, ${onlineJoins.createdAt}) < ${abandonedCutoff}`
            )
          )
        )
      )
      .returning({ id: onlineJoins.id });

    return cleared.length;
  } catch (e) {
    console.error("[JoinProof] retention sweep failed:", e);
    return 0;
  }
}
