"use server";

import { db } from "@/db";
import { onlineJoins } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { fulfilManualJoin } from "@/lib/fulfil-join";
import { notifyJoinConfirmed } from "@/lib/join-notify";

/**
 * Owner-side actions for the manual UPI join flow.
 *
 * A join request is only ever fulfilled from here, and only after the owner has
 * looked at their own UPI/bank record — there is no gateway signature to trust.
 * Every export asserts owner and re-checks that the request belongs to a branch
 * the owner is currently scoped to, so switching to a single branch in the
 * admin genuinely limits what these can touch.
 */

/**
 * Owner + the join must be in the owner's current branch scope.
 *
 * The two error strings are `as const` on purpose: callers narrow with
 * `if (loaded.error)`, and only an always-truthy literal type lets TypeScript
 * drop the error variants so `loaded.join` is non-optional afterwards.
 */
async function loadJoinInScope(joinId: number) {
  const joins = await db
    .select()
    .from(onlineJoins)
    .where(eq(onlineJoins.id, joinId))
    .limit(1);
  if (!joins.length) return { error: "Request not found." as const };
  const join = joins[0];

  const scope = await getBranchScope();
  const inScope =
    scope.type === "all"
      ? scope.branchIds.includes(join.branchId)
      : scope.branchId === join.branchId;
  if (!inScope) {
    return { error: "This request belongs to a branch you're not viewing." as const };
  }
  return { join };
}

/**
 * Confirm a manual UPI payment → create/renew the membership.
 *
 * Delegates the writes to fulfilManualJoin (compare-and-swap, so confirming
 * twice is safe). On success calls notifyJoinConfirmed, which emails the member
 * their Gym ID when they supplied an address and hands the owner a one-tap
 * WhatsApp link to send it by hand — the dependable channel either way, and the
 * only one until the email domain is verified.
 */
export async function confirmManualJoinPayment(joinId: number) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can confirm payments." };
  }

  try {
    const loaded = await loadJoinInScope(joinId);
    if (loaded.error) return { error: loaded.error };
    const { join } = loaded;

    if (join.status === "rejected") {
      return { error: "This request was rejected — it can't be confirmed." };
    }

    const result = await fulfilManualJoin({
      join,
      upiReference: join.upiReference,
      consentIp: null, // owner-confirmed server-side; there is no member request IP
    });

    if (!result.ok) {
      if (result.code === "claimed") {
        return { error: "This request has already been confirmed." };
      }
      return { error: result.error };
    }

    // ===== GYM ID DELIVERY =====
    // Email (only if they gave one) plus the owner's one-tap WhatsApp link.
    // Shared with both gateway paths so a member gets the same thing whether the
    // owner confirmed by hand or Razorpay captured the money — see
    // src/lib/join-notify.ts.
    const notify = await notifyJoinConfirmed({
      email: join.email,
      branchId: join.branchId,
      memberName: result.memberName,
      gymId: result.gymId,
      planName: result.planName,
      amount: result.amount,
      expiry: result.expiry,
      contactNumber: result.contactNumber,
      isRenewal: Boolean(join.memberId),
    });

    revalidatePath("/admin/join-requests");
    revalidatePath("/admin/members");
    revalidatePath("/admin");

    return {
      success: true,
      gymId: result.gymId,
      expiry: result.expiry,
      memberName: result.memberName,
      whatsappLink: notify.whatsappLink,
      // So the owner's toast can say whether the member already has it in
      // writing, or whether the WhatsApp tap is the only copy going out.
      emailedTo: notify.emailSent ? join.email : null,
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to confirm payment") };
  }
}

/**
 * Reject a pending/claimed request. Sets status "rejected" (compare-and-swap so
 * it can't clobber a request that was confirmed in the meantime). Nothing is
 * charged and no member is created.
 *
 * rejectedAt starts the 10-day retention clock on the payment screenshot — see
 * sweepExpiredJoinProofs. The screenshot is deliberately kept for now: a rejected
 * member is the one most likely to come back and argue, and the owner wants the
 * evidence in hand when they do.
 */
export async function rejectJoinRequest(joinId: number, reason?: string) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can reject requests." };
  }

  try {
    const loaded = await loadJoinInScope(joinId);
    if (loaded.error) return { error: loaded.error };
    const { join } = loaded;

    if (join.status === "paid") {
      return {
        error:
          "This request is already confirmed and a membership exists. Remove the member from the Members page instead.",
      };
    }

    const updated = await db
      .update(onlineJoins)
      .set({ status: "rejected", rejectedAt: new Date() })
      .where(
        and(
          eq(onlineJoins.id, join.id),
          // Only pending/claimed can be rejected — never overwrite "paid".
          eq(onlineJoins.status, join.status)
        )
      )
      .returning({ id: onlineJoins.id });

    if (updated.length === 0) {
      return { error: "This request just changed — refresh and try again." };
    }

    // reason is accepted for a future audit trail; not stored yet (no column).
    void reason;

    revalidatePath("/admin/join-requests");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to reject request") };
  }
}

/**
 * Clear one settled request's payment screenshot from the database.
 *
 * This is the owner's manual lever for confirmed requests, which are otherwise
 * kept indefinitely: once the membership exists the screenshot has done its job,
 * but whether to keep it is a judgement call, so it's theirs to make rather than
 * something a sweep decides. It also lets them clear a rejected request early
 * instead of waiting out the 10 days.
 *
 * The admin UI offers a download beside this, so "keep a copy, drop it from the
 * database" is one action after another rather than a choice between the two.
 *
 * proofUploadedAt survives — the record that a screenshot was submitted, and
 * when, is the audit trail and outlives the image itself.
 */
export async function deleteJoinProof(joinId: number) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can delete a payment screenshot." };
  }

  if (!Number.isInteger(joinId) || joinId <= 0) {
    return { error: "That request doesn't exist." };
  }

  try {
    const scope = await getBranchScope();

    // Branch scope and the status gate both live in the WHERE clause, so this is
    // a single statement that never reads the ~80KB blob it is about to discard.
    //
    // Settled requests only. While one is still pending or claimed the
    // screenshot is the only evidence the owner has to decide on, so it isn't
    // theirs to throw away yet.
    const updated = await db
      .update(onlineJoins)
      .set({ proofImage: null, proofMime: null })
      .where(
        and(
          eq(onlineJoins.id, joinId),
          inArray(onlineJoins.status, ["paid", "rejected"]),
          scope.type === "single"
            ? eq(onlineJoins.branchId, scope.branchId)
            : inArray(onlineJoins.branchId, scope.branchIds)
        )
      )
      .returning({ id: onlineJoins.id });

    if (updated.length === 0) {
      // One message for every miss — no such request, another branch's request,
      // still awaiting a decision, or already cleared. Naming which would let a
      // caller map what exists and what state it's in.
      return {
        error:
          "Couldn't delete that screenshot — it may already be cleared, or the request is still awaiting your decision.",
      };
    }

    revalidatePath("/admin/join-requests");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to delete the screenshot") };
  }
}
