"use server";

import { db } from "@/db";
import { members, payments, onlineJoins, smsLogs } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
// The same whitelist the register import uses, so "Male" and "M" mean one thing
// everywhere a member's gender can be set.
import { parseSex } from "@/lib/import-parse";
import { istDateString, addDaysIso, formatINR } from "@/lib/utils";
import { formatDateIn, type MemberChange } from "@/lib/whatsapp";
import {
  assertPermission,
  assertAuthenticated,
  getHiddenFields,
} from "@/lib/auth-check";

/**
 * What changed, in the terms a member would recognise, for the WhatsApp message
 * offered after a save.
 *
 * Computed here rather than in the browser because a field the owner has hidden
 * from this account is left out of the SET list — a client-side diff would
 * announce a change that was never written.
 */
function diffMemberChanges(
  before: {
    name: string;
    contactNumber: string;
    feeAmount: number;
    membershipExpiry: string;
  },
  after: {
    name: string;
    contactNumber: string;
    feeAmount: number;
    membershipExpiry: string;
  }
): MemberChange[] {
  const changes: MemberChange[] = [];

  if (before.name !== after.name) {
    changes.push({
      field: "name",
      label: "Name",
      from: before.name,
      to: after.name,
    });
  }
  if (before.contactNumber !== after.contactNumber) {
    changes.push({
      field: "contactNumber",
      label: "Phone",
      from: before.contactNumber || "—",
      to: after.contactNumber || "—",
    });
  }
  if (before.feeAmount !== after.feeAmount) {
    changes.push({
      field: "feeAmount",
      label: "Fees",
      from: formatINR(before.feeAmount),
      to: formatINR(after.feeAmount),
    });
  }
  if (before.membershipExpiry !== after.membershipExpiry) {
    changes.push({
      field: "membershipExpiry",
      label: "Due Date",
      // A blank due date is a real state, not a formatting failure, so it says
      // so rather than rendering as an empty arrow.
      from: formatDateIn(before.membershipExpiry) || "not recorded",
      to: formatDateIn(after.membershipExpiry) || "not recorded",
    });
  }

  return changes;
}

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

    // Both writes in one transaction. As two independent statements, a failure
    // between them left a member row with no payment for the fee that was taken
    // at the desk — the member exists, the money is missing from every revenue
    // total, and nothing reports it.
    const created = await db.transaction(async (tx) => {
      const newMember = await tx
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
          gender: parseSex(formData.get("gender")),
        })
        .returning();

      // No payment row when there is no amount: a ₹0 payment would sit in the
      // history and in every revenue total as a real collection that never
      // happened. The owner records the payment when they fill the fee in.
      if (newMember.length > 0 && resolvedFee > 0) {
        await tx.insert(payments).values({
          branchId: branch.branchId,
          memberId: newMember[0].id,
          amount: resolvedFee,
          date: joiningDate || today,
        });
      }

      return newMember[0] ?? null;
    });

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    // The id is returned so an enquiry converted from the enquiry list can be
    // linked to the member it became.
    return { success: true, memberId: created?.id };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add member") };
  }
}

// ===== UPDATE MEMBER =====
/**
 * `changes` is what feeds the "tell them what changed" WhatsApp sheet. Declared
 * as a real union — like RenewOutcome below — so the client has to narrow it
 * instead of reading a property that the error branch does not carry.
 */
export type UpdateOutcome =
  | { error: string }
  | { success: true; changes: MemberChange[] };

export async function updateMemberAction(
  id: number,
  formData: FormData
): Promise<UpdateOutcome> {
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
        // Not a hideable field, so it is written unconditionally — the form
        // always renders it, and the empty option means "clear it". Deliberately
        // absent from `diffMemberChanges` below: a correction to how a member is
        // recorded is not something to announce to them over WhatsApp.
        gender: parseSex(formData.get("gender")),
      })
      .where(eq(members.id, id));

    // NOTE: Do NOT bulk-update historical payments here. Rewriting every
    // payment row to the current feeAmount corrupts payment history, totals,
    // and revenue reporting. Editing a member only changes the member record;
    // past payments are immutable and are added via renew/add flows.

    // Fed to the "send them the update on WhatsApp" sheet. The fee is compared
    // against its own old value when it is hidden, so a field this account
    // cannot write never shows up as a change.
    const changes = diffMemberChanges(
      {
        name: existing[0].name,
        contactNumber: existing[0].contactNumber,
        feeAmount: existing[0].feeAmount,
        membershipExpiry: existing[0].membershipExpiry,
      },
      {
        name,
        contactNumber,
        feeAmount: feeHidden ? existing[0].feeAmount : feeAmount,
        membershipExpiry,
      }
    );

    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { success: true, changes };
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
    // released before the member row will delete, or Postgres blocks it with a
    // foreign-key violation ("delete from members ... $1" failing is exactly
    // that). All in one transaction so a mid-way failure leaves nothing behind.
    //
    // All three are DETACHED (memberId → NULL), never deleted:
    //   - payments:     money actually taken. The Privacy Policy tells members
    //                   these are kept 8 years for Indian tax law, so deleting
    //                   the member must not destroy the record. `member_id` is
    //                   nullable and no query INNER JOINs payments→members, so
    //                   detaching hides these rows from nothing and the revenue
    //                   sum (which filters on branch_id) is unchanged.
    //   - online_joins: the Razorpay order/payment record.
    //   - sms_logs:     delivery audit trail.
    //
    // The consequence to be aware of: a deleted member's payments survive as
    // rows with no member, so "delete" no longer erases a member's money
    // history. Deactivate (isActive) rather than delete if the intent is to
    // stop them appearing in the list.
    await db.transaction(async (tx) => {
      await tx
        .update(onlineJoins)
        .set({ memberId: null })
        .where(eq(onlineJoins.memberId, id));
      await tx
        .update(smsLogs)
        .set({ memberId: null })
        .where(eq(smsLogs.memberId, id));
      await tx
        .update(payments)
        .set({ memberId: null })
        .where(eq(payments.memberId, id));
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

    // ===== ONE TRANSACTION, AND THE ROW LOCKED =====
    // This was a plain read, then an update, then an insert as three independent
    // statements. Two problems, both silent:
    //
    //   LOST UPDATE — press Renew twice (or twice from two tabs, or once here
    //   while a member pays online) and both calls read the same starting expiry
    //   and compute the same +N days, so two payments are taken and the
    //   membership is extended once.
    //
    //   TORN WRITE — if the payment insert failed after the update committed,
    //   the membership was extended with no payment recorded, and revenue
    //   understated it forever.
    //
    // FOR UPDATE makes the row itself the unit of serialisation, so this
    // serialises against the online/UPI renewal paths in fulfil-join.ts too —
    // they lock the same row. The second caller blocks, then re-reads and sees
    // the first caller's expiry, which is what makes the extension cumulative.
    type RenewOutcome =
      | { error: string }
      | { success: true; newExpiry: string; changes: MemberChange[] };

    const outcome: RenewOutcome = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1)
        .for("update");
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

      await tx
        .update(members)
        .set({
          membershipExpiry: newExpiry,
          feeAmount: amount,
          planType: planType || member.planType,
          leftGym: false,
          wonBackAt: member.leftGym ? new Date() : member.wonBackAt,
        })
        .where(eq(members.id, memberId));

      await tx.insert(payments).values({
        branchId: member.branchId,
        memberId: member.id,
        amount,
        date: todayStr,
        method: paymentMethod,
      });

      return {
        success: true as const,
        newExpiry,
        changes: diffMemberChanges(
          {
            name: member.name,
            contactNumber: member.contactNumber,
            feeAmount: member.feeAmount,
            membershipExpiry: member.membershipExpiry,
          },
          {
            name: member.name,
            contactNumber: member.contactNumber,
            feeAmount: amount,
            membershipExpiry: newExpiry,
          }
        ),
      };
    });

    if ("error" in outcome) return outcome;

    // After the transaction commits, so a re-render can never read the old row.
    // Its failure is not a failed renewal, though: the payment and the new expiry
    // are already committed, and coming back as "Failed to renew membership" is
    // what gets the button pressed again — which charges the member a second
    // time. The pages here are force-dynamic, so the worst case is the owner's
    // own list refreshes itself a moment later instead.
    try {
      revalidatePath("/admin/members");
      revalidatePath("/admin");
    } catch {
      // Stale list at worst.
    }
    return outcome;
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

// ===== BULK MARK / RESTORE =====
// Unexported on purpose: only async functions may be exported from a "use server"
// file, and every export of one becomes a publicly callable endpoint besides.
// The client keeps its own copy of this union in inactive-client.tsx.
const LEFT_REASONS = [
  "shifted",
  "not_interested",
  "health",
  "financial",
  "other",
] as const;
type LeftReason = (typeof LEFT_REASONS)[number];

/**
 * How many ids go into one UPDATE.
 *
 * Not a tuning knob. A round trip to Neon measures ~78ms and Netlify kills a
 * synchronous function at 10s, which is the same budget that forced the register
 * import to be chunked — a per-member loop there died around row 126 and lost
 * two thirds of the register. Marking 1,500 members is three statements at this
 * size, ~250ms, against a per-row loop that would never finish.
 */
const BULK_CHUNK = 500;
/** The whole book is ~1,500 rows. This only exists to refuse a runaway payload. */
const BULK_MAX = 5000;
/** One note is copied onto every row in the batch, so it stays short. */
const BULK_NOTE_MAX = 300;

/**
 * Shared by both bulk actions, so the guard, the branch filter and the chunking
 * can only ever be written once.
 *
 * `marking` picks the direction. Branch scope and the member's *current* state
 * both live in the WHERE clause rather than in a per-row read: an id from
 * another branch, or one already in the target state, simply does not match, and
 * nothing is revealed by probing with one. It also makes a re-run a no-op.
 *
 * Returns a discriminated result rather than the bare `{ error }` the
 * single-member actions use. Those have nothing to report on success, so
 * `if (r.error)` reads fine; here a caller has counts to read afterwards, and
 * narrowing on a plain `error: string` cannot eliminate the failure branch —
 * the empty string is falsy.
 */
async function bulkSetLeft(
  ids: number[],
  marking: boolean,
  reason?: LeftReason,
  note?: string
): Promise<
  | { success: true; changed: number; skipped: number }
  | { success: false; error: string }
> {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("members", "canEdit");
    }
  } catch (e) {
    return {
      success: false,
      error: sanitizeError(e, "Not authorized to modify members"),
    };
  }

  try {
    // Validated before it reaches SQL — a client may send anything, and one NaN
    // in the list fails the whole statement rather than that one row.
    const wanted = Array.from(
      new Set(ids.filter((id) => Number.isInteger(id) && id > 0))
    );
    if (wanted.length === 0) {
      return { success: false, error: "No members selected" };
    }
    if (wanted.length > BULK_MAX) {
      return {
        success: false,
        error: `Too many members in one go (limit ${BULK_MAX})`,
      };
    }

    const scope = await getBranchScope();
    const branchIds = scope.type === "all" ? scope.branchIds : [scope.branchId];

    let changed = 0;
    for (let i = 0; i < wanted.length; i += BULK_CHUNK) {
      const chunk = wanted.slice(i, i + BULK_CHUNK);
      const rows = await db
        .update(members)
        .set(
          marking
            ? {
                leftGym: true,
                leftGymDate: istDateString(),
                leftGymReason: reason,
                leftGymNote: note || null,
              }
            : {
                // Same four fields the single-member restore writes, and it
                // leaves wonBackAt alone for the same reason: that date records
                // that the member came back once, and undoing a mark does not
                // un-happen it.
                leftGym: false,
                leftGymDate: null,
                leftGymReason: null,
                leftGymNote: null,
              }
        )
        .where(
          and(
            inArray(members.id, chunk),
            inArray(members.branchId, branchIds),
            eq(members.leftGym, !marking)
          )
        )
        .returning({ id: members.id });
      changed += rows.length;
    }

    revalidatePath("/admin/members");
    revalidatePath("/admin/inactive");
    revalidatePath("/admin/reminders");
    revalidatePath("/admin");

    // What the WHERE clause refused, so the caller can report the difference
    // instead of a number that does not match what it asked for.
    return { success: true, changed, skipped: wanted.length - changed };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(
        error,
        marking ? "Failed to mark members as left" : "Failed to restore members"
      ),
    };
  }
}

/**
 * Mark a whole batch as left with one reason.
 *
 * Takes an explicit id list rather than filter criteria on purpose: the caller
 * sends what it can see, so the operation is exactly what was on screen and
 * cannot sweep up a member whose state changed while the list was open.
 */
export async function bulkMarkMembersLeftAction(
  ids: number[],
  reason: LeftReason,
  note?: string
) {
  // Typed at the call site, but this arrives over the wire — the column is a
  // bare text and would happily store anything.
  if (!LEFT_REASONS.includes(reason)) {
    return { success: false as const, error: "Invalid reason" };
  }
  return bulkSetLeft(ids, true, reason, note?.trim().slice(0, BULK_NOTE_MAX));
}

/** Undo a batch. Mirrors unmarkMemberLeftAction, without the wonBackAt reset. */
export async function bulkRestoreMembersAction(ids: number[]) {
  return bulkSetLeft(ids, false);
}