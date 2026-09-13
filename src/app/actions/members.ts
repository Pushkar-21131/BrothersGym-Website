"use server";

import { db } from "@/db";
import { members, payments, onlineJoins, smsLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { istDateString, addDaysIso } from "@/lib/utils";
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

  // Which fields this account is even allowed to see. An owner can hide any of
  // them per staff account, and the form then does not render the input at all
  // — so `formData.get()` returns null and validating it unconditionally
  // rejects a field the user has no way to fill in.
  //
  // Read once, used twice below. This generalises what the code already did for
  // parentName alone.
  const hiddenFields = await getHiddenFields("members");
  const feeHidden = hiddenFields.includes("feeAmount");
  const parentNameHidden = hiddenFields.includes("parentName");

  if (!gymId || !name || !contactNumber || !emergencyContact || !membershipExpiry) {
    return { error: "Please fill all required fields" };
  }

  // Fee is required only from someone who can see the field. member-list.tsx
  // renders the fee input behind the same check, so for a staff account with
  // fees hidden `parseInt(null)` was NaN — which surfaced as "Please fill all
  // required fields" naming a field that is not on their screen, and made
  // adding a member impossible for exactly the configuration an owner is most
  // likely to set up (can add members, cannot see money).
  if (!feeHidden && !feeAmount) {
    return { error: "Fee amount is required" };
  }

  // Parent name is mandatory on new members, but only for staff who can
  // actually see the field. An owner may hide it from a given staff account,
  // and the form then never renders the input — demanding it unconditionally
  // would lock those accounts out of adding members entirely.
  if (!parentName && !parentNameHidden) {
    return { error: "Parent / Father name is required" };
  }

  // Nothing was typed and nothing can be inferred, so the fee is recorded as 0
  // rather than NaN. It shows as ₹0 in the members list, which is the owner's
  // cue to set the real figure — better than a rejected form or a fabricated
  // amount.
  const resolvedFee = feeHidden ? 0 : feeAmount;

  try {
    const branch = await requireSingleBranch(formBranchId);
    const today = istDateString();

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
        feeAmount: resolvedFee,
        joiningDate: joiningDate || today,
        membershipExpiry,
      })
      .returning();

    // No payment row when there is no amount: a ₹0 payment would sit in the
    // history and in every revenue total as a real collection that never
    // happened. The owner records the payment when they fill the fee in.
    if (newMember.length > 0 && resolvedFee > 0) {
      await db.insert(payments).values({
        branchId: branch.branchId,
        memberId: newMember[0].id,
        amount: resolvedFee,
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

  // Same reasoning as the add path: a hidden field is not rendered, so it
  // arrives as null — and on an UPDATE that is worse than a confusing error
  // message, because null is a value.
  //
  //   feeAmount  — `parseInt(null)` is NaN, which reached `.set()` below and
  //                Postgres rejected the whole statement. A staff account with
  //                fees hidden could not save any edit to any member.
  //   email      — `null || null` wrote NULL, silently deleting the stored
  //   parentName   address / father's name the moment such an account saved an
  //   address      unrelated change.
  //
  // Every hideable field is therefore omitted from the SET list rather than
  // written, so the stored value survives untouched.
  //
  // `address` was the one that got missed, because until now it was not hidden
  // anywhere: the column was in the payload, the table, the export and the edit
  // form no matter what the owner configured. Now that member-list.tsx drops
  // the input when it is hidden, this guard is what stops the blank form field
  // from erasing the address on the next save.
  const hiddenFields = await getHiddenFields("members");
  const feeHidden = hiddenFields.includes("feeAmount");
  const emailHidden = hiddenFields.includes("email");
  const addressHidden = hiddenFields.includes("address");
  const parentNameHidden = hiddenFields.includes("parentName");
  const emergencyHidden = hiddenFields.includes("emergencyContact");

  if (!feeHidden && !Number.isFinite(feeAmount)) {
    return { error: "Fee amount is required" };
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
        gymId,
        name,
        ...(emailHidden ? {} : { email: email || null }),
        contactNumber,
        ...(addressHidden ? {} : { address: address || null }),
        // Deliberately still nullable on edit. Members added before parent name
        // was mandatory have a blank one, and requiring it here would make every
        // one of those rows un-editable until someone tracked the name down.
        ...(parentNameHidden ? {} : { parentName: parentName || null }),
        ...(emergencyHidden ? {} : { emergencyContact }),
        ...(feeHidden ? {} : { feeAmount }),
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

  // These arrive as arguments, not form fields, so nothing has validated them.
  // A zero or NaN amount writes a ₹0 payment row that counts as a real
  // collection in every revenue total, and zeroes the member's stored fee on
  // the way past.
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter the amount collected" };
  }
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return { error: "Select a membership duration" };
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

    // Calendar arithmetic on "YYYY-MM-DD" strings — see lib/utils. An
    // unexpired membership extends from its own expiry, a lapsed one from
    // today.
    const todayStr = istDateString();
    const base =
      member.membershipExpiry > todayStr ? member.membershipExpiry : todayStr;
    const newExpiry = addDaysIso(base, durationDays);

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
      date: todayStr,
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
        leftGymDate: istDateString(),
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