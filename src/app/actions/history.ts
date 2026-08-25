"use server";

import { db } from "@/db";
import { payments, members } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";

export async function getMemberPaymentHistory(memberId: number) {
  try {
    const scope = await getBranchScope();

    const memberRows = await db
      .select()
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

    const allPayments = await db
      .select()
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