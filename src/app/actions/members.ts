"use server";

import { db } from "@/db";
import { members, payments, onlineJoins, smsLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import {
  assertPermission,
  assertAuthenticated,
  getHiddenFields,
} from "@/lib/auth-check";

// ===== ADD MEMBER =====
export async function addMemberAction(formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canAdd");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add members") };
  }

  const gymId = parseInt(formData.get("gymId") as string);
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const contactNumber = (formData.get("contactNumber") as string)?.trim();
  const address = (formData.get("address") as string)?.trim();
  const parentName = (formData.get("parentName") as string)?.trim();
  const emergencyContact = (formData.get("emergencyContact") as string)?.trim();
  const feeAmount = parseInt(formData.get("feeAmount") as string);
  const joiningDate = formData.get("joiningDate") as string;
  const membershipExpiry = formData.get("membershipExpiry") as string;

  const formBranchId = formData.get("branchId")
    ? Number(formData.get("branchId"))
    : undefined;

  if (
    !gymId ||
    !name ||
    !contactNumber ||
    !emergencyContact ||
    !feeAmount ||
    !membershipExpiry
  ) {
    return { error: "Please fill all required fields" };
  }

  // Parent name is mandatory on new members, but only for staff who can
  // actually see the field. An owner may hide it from a given staff account,
  // and the form then never renders the input — demanding it unconditionally
  // would lock those accounts out of adding members entirely.
  const parentNameHidden = (await getHiddenFields("members")).includes(
    "parentName"
  );
  if (!parentName && !parentNameHidden) {
    return { error: "Parent / Father name is required" };
  }

  try {
    const branch = await requireSingleBranch(formBranchId);
    const today = new Date().toISOString().split("T")[0];

    const newMember = await db
      .insert(members)
      .values({
        branchId: branch.branchId,
        gymId,
        name,
        email: email || null,
        contactNumber,
        address: address || null,
        parentName: parentName || null,
        emergencyContact,
        feeAmount,
        joiningDate: joiningDate || today,
        membershipExpiry,
      })
      .returning();

    if (newMember.length > 0) {
      await db.insert(payments).values({
        branchId: branch.branchId,
        memberId: newMember[0].id,
        amount: feeAmount,
        date: joiningDate || today,
      });
    }

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add member") };
  }
}

// ===== UPDATE MEMBER =====
export async function updateMemberAction(id: number, formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit members") };
  }

  const gymId = parseInt(formData.get("gymId") as string);
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const contactNumber = (formData.get("contactNumber") as string)?.trim();
  const address = (formData.get("address") as string)?.trim();
  const parentName = (formData.get("parentName") as string)?.trim();
  const emergencyContact = (formData.get("emergencyContact") as string)?.trim();
  const feeAmount = parseInt(formData.get("feeAmount") as string);
  const joiningDate = formData.get("joiningDate") as string;
  const membershipExpiry = formData.get("membershipExpiry") as string;

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (existing.length === 0) return { error: "Member not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    await db
      .update(members)
      .set({
        gymId,
        name,
        email: email || null,
        contactNumber,
        address: address || null,
        // Deliberately still nullable on edit. Members added before parent name
        // was mandatory have a blank one, and requiring it here would make every
        // one of those rows un-editable until someone tracked the name down.
        parentName: parentName || null,
        emergencyContact,
        feeAmount,
        joiningDate,
        membershipExpiry,
      })
      .where(eq(members.id, id));

    // NOTE: Do NOT bulk-update historical payments here. Rewriting every
    // payment row to the current feeAmount corrupts payment history, totals,
    // and revenue reporting. Editing a member only changes the member record;
    // past payments are immutable and are added via renew/add flows.

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update member") };
  }
}

// ===== DELETE MEMBER =====
export async function deleteMemberAction(id: number) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canDelete");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete members") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (existing.length === 0) return { error: "Member not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    // A member can be referenced by three tables. Every one of them must be
    // cleared before the member row will delete, or Postgres blocks it with a
    // foreign-key violation ("delete from members ... $1" failing is exactly
    // that). All in one transaction so a mid-way failure leaves nothing behind.
    //   - payments:     history for THIS member only → delete outright.
    //   - online_joins: the Razorpay order/payment record. Detach (memberId is
    //                   nullable) so the financial record survives the member.
    //   - sms_logs:     delivery audit trail. Detach for the same reason.
    await db.transaction(async (tx) => {
      await tx
        .update(onlineJoins)
        .set({ memberId: null })
        .where(eq(onlineJoins.memberId, id));
      await tx
        .update(smsLogs)
        .set({ memberId: null })
        .where(eq(smsLogs.memberId, id));
      await tx.delete(payments).where(eq(payments.memberId, id));
      await tx.delete(members).where(eq(members.id, id));
    });

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete member") };
  }
}

// ===== RENEW MEMBER =====
export async function renewMemberAction(
  memberId: number,
  amount: number,
  durationDays: number,
  planType?: "full" | "no_cardio" | "offline",
  paymentMethod: "cash" | "upi" | "razorpay" | "other" = "cash"
) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to renew members") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);
    if (existing.length === 0) return { error: "Member not found" };

    const member = existing[0];

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(member.branchId)
        : scope.branchId === member.branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    const today = new Date();
    const currentExpiry = new Date(member.membershipExpiry);
    const base = currentExpiry > today ? currentExpiry : today;
    base.setDate(base.getDate() + durationDays);
    const newExpiry = base.toISOString().split("T")[0];

    await db
      .update(members)
      .set({
        membershipExpiry: newExpiry,
        feeAmount: amount,
        planType: planType || member.planType,
        leftGym: false,
        wonBackAt: member.leftGym ? new Date() : member.wonBackAt,
      })
      .where(eq(members.id, memberId));

    await db.insert(payments).values({
      branchId: member.branchId,
      memberId: member.id,
      amount,
      date: new Date().toISOString().split("T")[0],
      method: paymentMethod,
    });

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { success: true, newExpiry };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to renew membership") };
  }
}

// ===== MARK MEMBER LEFT =====
export async function markMemberLeftAction(
  id: number,
  reason: "shifted" | "not_interested" | "health" | "financial" | "other",
  note?: string
) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to modify members") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (existing.length === 0) return { error: "Member not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    await db
      .update(members)
      .set({
        leftGym: true,
        leftGymDate: new Date().toISOString().split("T")[0],
        leftGymReason: reason,
        leftGymNote: note || null,
      })
      .where(eq(members.id, id));

    revalidatePath("/admin/members");
    revalidatePath("/admin/inactive");
    revalidatePath("/admin/reminders");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to mark member as left") };
  }
}

// ===== UNMARK MEMBER LEFT =====
export async function unmarkMemberLeftAction(id: number) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to modify members") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (existing.length === 0) return { error: "Member not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;

    if (!canAccess) return { error: "You don't have access to this member" };

    await db
      .update(members)
      .set({
        leftGym: false,
        leftGymDate: null,
        leftGymReason: null,
        leftGymNote: null,
      })
      .where(eq(members.id, id));

    revalidatePath("/admin/members");
    revalidatePath("/admin/inactive");
    revalidatePath("/admin/reminders");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to unmark member") };
  }
}