"use server";

import { db } from "@/db";
import { onlineJoins, branches } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { assertOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { fulfilManualJoin } from "@/lib/fulfil-join";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { formatDayIST } from "@/lib/manual-join";
import { fromHeader, joinConfirmedEmail } from "@/lib/email-templates";

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
 * twice is safe). On success sends the member their confirmation email
 * (best-effort) and hands the owner a one-tap WhatsApp link to send the Gym ID
 * by hand — the dependable member channel until the email domain is verified.
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

    const isRenewal = Boolean(join.memberId);

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

    // Branch name for the email + WhatsApp copy.
    const branchRow = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, join.branchId))
      .limit(1);
    const branchName = branchRow[0]?.name || "";

    const validUntil = formatDayIST(result.expiry);

    // ===== Member confirmation email (best-effort; never blocks) =====
    if (join.email) {
      try {
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey && !/x{4,}/i.test(apiKey)) {
          const { subject, html, text } = joinConfirmedEmail({
            memberName: result.memberName,
            gymId: result.gymId,
            planName: result.planName,
            amount: result.amount,
            expiry: result.expiry,
            branchName,
            isRenewal,
          });
          await new Resend(apiKey).emails.send({
            from: fromHeader(),
            to: join.email,
            subject,
            html,
            text,
          });
        }
      } catch (e) {
        console.error("[ManualJoin] member confirmation email failed:", e);
      }
    }

    // ===== One-tap WhatsApp for the owner =====
    const waMessage = isRenewal
      ? `Hi ${result.memberName}! 💪 Your Brothers Gym membership is renewed.\n\nGym ID: ${result.gymId}\n${
          result.planName ? `Plan: ${result.planName}\n` : ""
        }Valid until: ${validUntil}\n\nThanks for staying with us!\n- Brothers Gym`
      : `Hi ${result.memberName}! 💪 Welcome to Brothers Gym — your membership is confirmed.\n\nGym ID: ${result.gymId}\n${
          result.planName ? `Plan: ${result.planName}\n` : ""
        }Valid until: ${validUntil}\n\nShow your Gym ID at the counter. See you at the gym!\n- Brothers Gym`;
    const whatsappLink = buildWhatsAppLink(result.contactNumber, waMessage);

    revalidatePath("/admin/join-requests");
    revalidatePath("/admin/members");
    revalidatePath("/admin");

    return {
      success: true,
      gymId: result.gymId,
      expiry: result.expiry,
      memberName: result.memberName,
      whatsappLink,
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to confirm payment") };
  }
}

/**
 * Reject a pending/claimed request. Sets status "rejected" (compare-and-swap so
 * it can't clobber a request that was confirmed in the meantime). Nothing is
 * charged and no member is created.
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
      .set({ status: "rejected" })
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
