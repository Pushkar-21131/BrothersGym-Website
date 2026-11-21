"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { members, payments } from "@/db/schema";
import { assertOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { recordActivity } from "@/lib/activity";
import { validReceivedDate } from "@/lib/dashboard-finance";
import { formatINR, gymCycle, istDateString } from "@/lib/utils";
import { sanitizeError } from "@/lib/errors";

export async function correctPaymentDateAction(paymentId: number, receivedDate: string, expectedDate: string) {
  try {
    await assertOwner();
    if (!Number.isInteger(paymentId) || paymentId <= 0 || !validReceivedDate(receivedDate, istDateString())) {
      return { error: "Enter a valid received date on or before today." };
    }
    const scope = await getBranchScope();
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
      const allowed = payment && (scope.type === "single" ? payment.branchId === scope.branchId : scope.branchIds.includes(payment.branchId));
      if (!allowed) return { error: "Payment not found." };
      if (payment.voidedAt) return { error: "Removed payments cannot be edited." };
      if (payment.razorpayOrderId || payment.razorpayPaymentId) {
        return { error: "This verified online payment is dated automatically and cannot be changed here." };
      }
      const cycle = gymCycle(receivedDate);
      if (payment.date === receivedDate) return { success: true as const, cycle, amount: payment.amount };
      if (payment.date !== expectedDate) return { error: "This payment was changed by someone else. Refresh the dashboard and try again." };
      const [member] = payment.memberId ? await tx.select({ name: members.name, gymId: members.gymId }).from(members).where(eq(members.id, payment.memberId)) : [];
      await tx.update(payments).set({ date: receivedDate }).where(eq(payments.id, paymentId));
      await recordActivity(tx, "payment.updated", `Corrected received date · ${member?.name ?? "Deleted member"}${member ? ` · gym #${member.gymId}` : ""} · ${formatINR(payment.amount)} · counted in ${cycle.label}`, {
        branchId: payment.branchId, subjectId: payment.id,
        changes: [{ field: "receivedDate", label: "Received date", before: payment.date, after: receivedDate }],
      });
      return { success: true as const, cycle, amount: payment.amount };
    });
    if ("error" in result) return result;
    try {
      revalidatePath("/admin");
      revalidatePath("/admin/members");
      revalidatePath("/admin/history");
    } catch {
      // The correction is committed; refreshing must not turn it into a failed save.
    }
    return result;
  } catch (error) {
    return { error: sanitizeError(error, "Could not update the received date.") };
  }
}
