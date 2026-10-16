"use server";

import { db } from "@/db";
import { payments, members } from "@/db/schema";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope } from "@/lib/branch";
import {
  assertAuthenticated,
  assertPermission,
  getCurrentUser,
} from "@/lib/auth-check";
import { logAuditEvent } from "@/lib/audit";
import { sanitizeError } from "@/lib/errors";

/**
 * A removed entry stops counting everywhere but is not deleted. The member's
 * timeline and the dashboard's collected total are the only two reads of
 * `payments`, and both filter on this — so "removed" means removed from the
 * numbers, while the row itself stays as the record that money was once entered
 * against this member. See the note on the column in schema.ts.
 */
const stillCounts = isNull(payments.voidedAt);

export async function getMemberPaymentHistory(memberId: number) {
  // This is a "use server" export, so it is a public HTTP endpoint: the branch
  // check below was the only thing standing between a logged-in staff account
  // and every payment a member has ever made. Branch scope is not permission —
  // an account configured without members.canView is scoped to its branch just
  // the same, and could still read the full payment history of everyone in it.
  //
  // Same shape as every mutating action in members.ts: assert, then let the
  // branch check that follows narrow it further.
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canView");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to view member history") };
  }

  try {
    const scope = await getBranchScope();

    const memberRows = await db
      .select({
        id: members.id,
        gymId: members.gymId,
        branchId: members.branchId,
        name: members.name,
        contactNumber: members.contactNumber,
        membershipExpiry: members.membershipExpiry,
        joiningDate: members.joiningDate,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!memberRows.length) return { error: "Member not found" };
    const member = memberRows[0];

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(member.branchId)
        : scope.branchId === member.branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    // Exactly the four fields history-modal.tsx renders. `select()` was sending
    // the whole row — branchId, memberId, createdAt and both Razorpay
    // identifiers — into the browser for every payment in the timeline. A
    // gateway payment id is not a secret, but it is an identifier for a real
    // transaction and nothing on screen uses it.
    const allPayments = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        date: payments.date,
        method: payments.method,
      })
      .from(payments)
      .where(and(eq(payments.memberId, memberId), stillCounts))
      .orderBy(desc(payments.date));

    // What was taken out of the timeline, so the removal is visible rather than
    // silent and can be put back. The name is the account that did it at the
    // time, not a live lookup of who holds that role now.
    const removedRows = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        date: payments.date,
        method: payments.method,
        voidedAt: payments.voidedAt,
        voidedBy: payments.voidedBy,
      })
      .from(payments)
      .where(and(eq(payments.memberId, memberId), isNotNull(payments.voidedAt)))
      .orderBy(desc(payments.voidedAt));

    const history = allPayments.map((p, i) => {
      const prev = allPayments[i + 1];
      let gapDays: number | null = null;
      let gapDescription = "";

      if (prev) {
        const currentDate = new Date(p.date);
        const prevDate = new Date(prev.date);
        gapDays = Math.floor(
          (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (gapDays > 45) {
          const months = Math.floor(gapDays / 30);
          gapDescription = `Gap of ${months} month${months > 1 ? "s" : ""} (${gapDays} days) — member was inactive`;
        }
      }

      return { ...p, gapDays, gapDescription };
    });

    const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
    const firstJoinDate = allPayments[allPayments.length - 1]?.date || null;
    const lastPaymentDate = allPayments[0]?.date || null;
    const gapsFound = history.filter((h) => h.gapDescription).length;

    return {
      success: true,
      member: {
        id: member.id,
        gymId: member.gymId,
        branchId: member.branchId,
        name: member.name,
        contactNumber: member.contactNumber,
        currentExpiry: member.membershipExpiry,
        joiningDate: member.joiningDate,
      },
      history,
      removed: removedRows.map((r) => ({
        ...r,
        voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
      })),
      summary: {
        totalPaid,
        totalPayments: allPayments.length,
        removedCount: removedRows.length,
        firstJoinDate,
        lastPaymentDate,
        gapsFound,
      },
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load history") };
  }
}

/**
 * Signed in, allowed to delete members, and inside their own branch. Shared by
 * void and restore so the two cannot drift apart on the checks that matter —
 * this is the guard that stops one branch's account touching another's money.
 */
async function assertMayChangePayments() {
  const role = await assertAuthenticated();
  if (role !== "owner") {
    await assertPermission("members", "canDelete");
  }
}

/**
 * Load one payment and prove the caller may change it.
 *
 * Returns a union rather than throwing so the callers can hand the message
 * straight back to the owner; `"error" in result` narrows it at the call site.
 * The member join is for the audit line — a payment id means nothing to anyone
 * reading the log later, a gym number does.
 */
async function loadChangeablePayment(paymentId: number) {
  const scope = await getBranchScope();

  const rows = await db
    .select({
      id: payments.id,
      branchId: payments.branchId,
      memberId: payments.memberId,
      amount: payments.amount,
      date: payments.date,
      method: payments.method,
      voidedAt: payments.voidedAt,
      gymId: members.gymId,
    })
    .from(payments)
    .leftJoin(members, eq(payments.memberId, members.id))
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!rows.length) return { error: "That payment is not on file" };
  const payment = rows[0];

  const canAccess =
    scope.type === "all"
      ? scope.branchIds.includes(payment.branchId)
      : scope.branchId === payment.branchId;

  if (!canAccess) return { error: "You don't have access to this payment" };

  return { payment };
}

/**
 * Take a payment out of the member's timeline and out of the collected total.
 *
 * A void, not a delete: the row stays, stamped with who did it and when, and
 * restorePaymentAction puts it back. Nothing here touches the member's due date
 * — a renewal moved that date and no longer carries the duration that moved it,
 * so the date is corrected in Edit, deliberately, by a person who knows what the
 * member actually paid for.
 */
export async function voidPaymentAction(paymentId: number) {
  try {
    await assertMayChangePayments();
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to remove a payment") };
  }

  try {
    const found = await loadChangeablePayment(paymentId);
    if ("error" in found) return found;
    const payment = found.payment;

    // A gateway row is Razorpay's own record that money moved, and the app has
    // no business hiding it — the join request and the member's receipt both
    // still point at it. A duplicate online payment is refunded at Razorpay,
    // which is the only side that can actually return the money.
    if (payment.method === "razorpay") {
      return {
        error: "Online payments can't be removed here — refund it in Razorpay.",
      };
    }

    const user = await getCurrentUser();
    // Pinned on the row still being live, so a second tap writes nothing and
    // gets the same answer as tapping an entry that was already removed.
    const updated = await db
      .update(payments)
      .set({ voidedAt: new Date(), voidedBy: user?.name || "unknown" })
      .where(and(eq(payments.id, paymentId), isNull(payments.voidedAt)))
      .returning({ id: payments.id });

    if (!updated.length) return { error: "That entry has already been removed" };

    await logAuditEvent(
      "payment.voided",
      `Removed ₹${payment.amount} dated ${payment.date} · payment #${payment.id}` +
        (payment.gymId ? ` · gym #${payment.gymId}` : "")
    );

    revalidatePath("/admin");
    revalidatePath("/admin/members");

    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Could not remove that entry") };
  }
}

/** Put a removed payment back, unchanged apart from the two void columns. */
export async function restorePaymentAction(paymentId: number) {
  try {
    await assertMayChangePayments();
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to restore a payment") };
  }

  try {
    const found = await loadChangeablePayment(paymentId);
    if ("error" in found) return found;
    const payment = found.payment;

    const updated = await db
      .update(payments)
      .set({ voidedAt: null, voidedBy: null })
      .where(and(eq(payments.id, paymentId), isNotNull(payments.voidedAt)))
      .returning({ id: payments.id });

    if (!updated.length) return { error: "That entry is already in the timeline" };

    await logAuditEvent(
      "payment.restored",
      `Put back ₹${payment.amount} dated ${payment.date} · payment #${payment.id}` +
        (payment.gymId ? ` · gym #${payment.gymId}` : "")
    );

    revalidatePath("/admin");
    revalidatePath("/admin/members");

    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Could not restore that entry") };
  }
}
