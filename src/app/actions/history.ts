"use server";

import { db } from "@/db";
import { payments, members } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getBranchScope } from "@/lib/branch";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";
import { sanitizeError } from "@/lib/errors";

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
      .where(eq(payments.memberId, memberId))
      .orderBy(desc(payments.date));

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
      summary: {
        totalPaid,
        totalPayments: allPayments.length,
        firstJoinDate,
        lastPaymentDate,
        gapsFound,
      },
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load history") };
  }
}