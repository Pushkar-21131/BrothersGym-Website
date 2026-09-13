/**
 * Shared fulfilment for a paid online join.
 *
 * Two different things can tell us a join was paid for:
 *
 *   1. the browser, via the Razorpay checkout `handler` callback, and
 *   2. Razorpay itself, via the `payment.captured` webhook.
 *
 * Both must end in exactly the same state, and between them they must never
 * create two members for one payment. So the write half lives here, once, and
 * both callers hand it an already-verified join row.
 *
 * This module is deliberately NOT a "use server" file. Everything exported from
 * one of those becomes a callable server action — i.e. a public HTTP endpoint —
 * and `fulfilPaidJoin` grants a membership. It must only ever be reachable from
 * server code that has already verified a signature.
 *
 * The CALLER is responsible for proving the money is real (signature check plus
 * a status/amount it trusts) and passes the captured amount in. This module owns
 * the writes: claiming the join, creating or renewing the member, recording the
 * payment, and linking the two.
 */

import { db } from "@/db";
import { members, payments, onlineJoins, membershipPlans } from "@/db/schema";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { istDateString, addDaysIso } from "@/lib/utils";

type MemberInsert = typeof members.$inferInsert;
export type OnlineJoin = typeof onlineJoins.$inferSelect;

/** Thrown to roll the transaction back when another caller got there first. */
export class JoinAlreadyClaimedError extends Error {}

/**
 * Allocate the next per-branch gym ID and insert the member as one indivisible
 * step.
 *
 * The read and the insert cannot be separated. Two people paying at the same
 * moment in the same branch would both read the same MAX, both try to insert the
 * same gym ID, and members_branch_gymid_unique would reject the loser — which,
 * inside the payment transaction, means a captured payment rolls back. The
 * advisory lock serialises allocation per branch and is released automatically
 * when the transaction commits or rolls back. It is keyed on branchId, so
 * branches never block each other.
 *
 * Must be called inside a transaction; `tx` is the transaction handle.
 */
export async function insertMemberWithNextGymId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: Omit<MemberInsert, "gymId">
): Promise<{ id: number; gymId: number }> {
  // 834127 is an arbitrary fixed namespace so this lock can't collide with an
  // advisory lock taken elsewhere for a different purpose on the same branch id.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(834127, ${values.branchId})`);

  const existing = await tx
    .select({ gymId: members.gymId })
    .from(members)
    .where(eq(members.branchId, values.branchId))
    .orderBy(desc(members.gymId))
    .limit(1);

  const gymId = existing.length > 0 ? existing[0].gymId + 1 : 1;

  const inserted = await tx
    .insert(members)
    .values({ ...values, gymId })
    .returning({ id: members.id, gymId: members.gymId });

  return inserted[0];
}

export type FulfilSuccess = {
  ok: true;
  memberId: number;
  gymId: number;
  expiry: string;
  amount: number;
  memberName: string;
  planName?: string;
  contactNumber: string;
};

export type FulfilFailure = {
  ok: false;
  /**
   * `claimed`  — someone else is mid-fulfilment; not an error worth alarming
   *              anyone about, and the webhook should ACK it.
   * `mismatch` — the money does not match the order; needs an operator.
   * `failed`   — the transaction rolled back; the join is still pending and can
   *              be retried.
   */
  code: "claimed" | "mismatch" | "failed";
  error: string;
};

export type FulfilResult = FulfilSuccess | FulfilFailure;

/**
 * Turn a verified, paid join row into a membership.
 *
 * Callers must ALREADY have proved this payment is genuine. `paidAmountPaise` is
 * whatever the caller independently confirmed was captured — from Razorpay's API
 * on the browser path, from the signed webhook body on the webhook path.
 *
 * Safe to call twice for the same join: the claim is a compare-and-swap and the
 * loser gets `code: "claimed"` without writing anything.
 */
export async function fulfilPaidJoin(params: {
  join: OnlineJoin;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paidAmountPaise: number;
  parentName?: string | null;
  emergencyContact?: string | null;
  /** Recorded against the member's consent. Null when Razorpay called us. */
  consentIp: string | null;
  source: "browser" | "webhook";
}): Promise<FulfilResult> {
  const { join, razorpayOrderId, razorpayPaymentId, source } = params;

  // Guards against a join row whose price changed between order and capture.
  if (params.paidAmountPaise !== join.amount * 100) {
    console.error(
      `[Payments] amount mismatch on join ${join.id} (${source}): paid ${params.paidAmountPaise}, expected ${join.amount * 100}`
    );
    return {
      ok: false,
      code: "mismatch",
      error: "Payment amount mismatch. Please contact us.",
    };
  }

  // isActive is deliberately NOT filtered here: the plan was active when the
  // order was created and the money is already taken, so a plan retired in the
  // meantime must still be honoured.
  const planRows = await db
    .select()
    .from(membershipPlans)
    .where(
      and(
        eq(membershipPlans.branchId, join.branchId),
        eq(membershipPlans.code, join.planCode as any)
      )
    )
    .limit(1);

  const plan = planRows[0];
  if (!plan) {
    // Only reachable if the plan row was hard-deleted between order and capture.
    // Falling back silently would quietly sell a 30-day membership to someone who
    // paid for a year, so it is logged as an operator problem.
    console.error(
      `[Payments] plan ${join.planCode} missing for branch ${join.branchId} on join ${join.id} — defaulting to 30 days`
    );
  }

  const durationDays = plan?.durationDays || 30;
  // The gym's calendar day, not the server's. See istDateString in lib/utils.
  const todayStr = istDateString();
  const planType = (
    join.planCode.includes("no_cardio") ? "no_cardio" : "full"
  ) as any;

  let outcome: { memberId: number; gymId: number; newExpiryStr: string };

  // ===== ONE TRANSACTION FOR ALL FOUR WRITES =====
  // The join must not be flipped to "paid" before the member exists. Any failure
  // after such a flip would leave someone who had paid with no membership row,
  // and a retry would hit the idempotency guard and cheerfully report success
  // with gymId 0. Either everything lands or nothing does.
  try {
    outcome = await db.transaction(async (tx) => {
      let memberId: number;
      let gymId: number;
      let newExpiryStr: string;

      // Claim inside the transaction so it rolls back with the rest. This is
      // also what makes the browser callback and the webhook safe to race:
      // whichever arrives second matches zero rows here.
      const claimed = await tx
        .update(onlineJoins)
        .set({ status: "paid", razorpayPaymentId })
        .where(
          and(eq(onlineJoins.id, join.id), eq(onlineJoins.status, "pending"))
        )
        .returning({ id: onlineJoins.id });

      if (claimed.length === 0) {
        throw new JoinAlreadyClaimedError();
      }

      // ===== EXISTING MEMBER (renewal) =====
      // The renewal target comes from join.memberId, which createOnlineJoinOrder
      // wrote after proving the caller knew that member's phone number. The
      // branch is re-asserted here as a second barrier in case a join row is ever
      // created by another path.
      if (join.memberId) {
        const existing = await tx
          .select()
          .from(members)
          .where(
            and(
              eq(members.id, join.memberId),
              eq(members.branchId, join.branchId)
            )
          )
          .limit(1);
        if (!existing.length) throw new Error("Existing member not found");
        const m = existing[0];

        // Both sides are "YYYY-MM-DD", so `>` compares them lexicographically,
        // which for a zero-padded ISO date is the same as comparing the dates.
        // A membership that has not lapsed extends from its own expiry; a
        // lapsed one restarts from today. Done as strings so nothing round-
        // trips through a Date and picks up a timezone shift on the way.
        const base =
          m.membershipExpiry > todayStr ? m.membershipExpiry : todayStr;
        newExpiryStr = addDaysIso(base, durationDays);

        await tx
          .update(members)
          .set({
            membershipExpiry: newExpiryStr,
            feeAmount: join.amount,
            planType,
            leftGym: false,
            wonBackAt: m.leftGym ? new Date() : m.wonBackAt,
          })
          .where(eq(members.id, m.id));

        memberId = m.id;
        gymId = m.gymId;
      }
      // ===== NEW MEMBER =====
      else {
        // Read from the join row, which was written at order creation after
        // validation. The caller-supplied values are only a fallback for join
        // rows created before those columns existed. Nothing here trusts the
        // browser: on the webhook path there is no browser at all.
        const parentName =
          join.parentName?.trim() || params.parentName?.trim() || null;
        const emergencyContact =
          join.emergencyContact?.trim() ||
          params.emergencyContact?.trim() ||
          join.contactNumber;

        if (!parentName) {
          console.error(
            `[Payments] join ${join.id} completed without a parent name (${source}) — fill it in from the admin panel`
          );
        }

        newExpiryStr = addDaysIso(todayStr, durationDays);

        const inserted = await insertMemberWithNextGymId(tx, {
          branchId: join.branchId,
          name: join.name,
          email: join.email,
          contactNumber: join.contactNumber,
          address: join.address,
          parentName,
          emergencyContact,
          feeAmount: join.amount,
          joiningDate: todayStr,
          membershipExpiry: newExpiryStr,
          planType,
          // Consent tracking (legal compliance)
          consentToHealthData: true,
          consentDate: new Date(),
          consentIpAddress: params.consentIp,
        });

        memberId = inserted.id;
        gymId = inserted.gymId;
      }

      // ===== RECORD PAYMENT =====
      await tx.insert(payments).values({
        branchId: join.branchId,
        memberId,
        amount: join.amount,
        date: todayStr,
        method: "razorpay",
        razorpayOrderId,
        razorpayPaymentId,
      });

      // ===== LINK THE JOIN TO THE MEMBER =====
      await tx
        .update(onlineJoins)
        .set({ memberId })
        .where(eq(onlineJoins.id, join.id));

      return { memberId, gymId, newExpiryStr };
    });
  } catch (e) {
    if (e instanceof JoinAlreadyClaimedError) {
      return {
        ok: false,
        code: "claimed",
        error: "This payment is already being processed.",
      };
    }
    // The transaction rolled back, so the join is still "pending" and can be
    // retried — by the member, by the webhook, or by an operator.
    console.error(`[Payments] join ${join.id} failed after capture (${source}):`, e);
    return {
      ok: false,
      code: "failed",
      error:
        "Your payment went through but we couldn't finish setting up your membership. Don't pay again — contact us with your payment ID and we'll activate it.",
    };
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin");

  return {
    ok: true,
    memberId: outcome.memberId,
    gymId: outcome.gymId,
    expiry: outcome.newExpiryStr,
    amount: join.amount,
    memberName: join.name,
    planName: plan?.name,
    contactNumber: join.contactNumber,
  };
}

/**
 * Turn a manually-paid (UPI) join row into a membership, on the owner's say-so.
 *
 * The manual sibling of `fulfilPaidJoin`. There is no gateway and no signature:
 * the "proof" is the owner looking at their own UPI/bank record and clicking
 * Confirm. So the CALLER must already have proved this request is the owner's to
 * act on (owner auth + branch scope) before calling this.
 *
 * Deliberately kept separate from `fulfilPaidJoin` rather than refactored into a
 * shared core: that function is the still-restorable Razorpay path, and touching
 * its internals to serve the manual flow would put a dormant-but-working path at
 * risk. The member create/renew block is duplicated on purpose.
 *
 * Safe to call twice: the claim is a compare-and-swap over ("pending","claimed")
 * and the loser gets `code: "claimed"` without writing anything.
 */
export async function fulfilManualJoin(params: {
  join: OnlineJoin;
  /** UTR the owner optionally typed at confirm time; falls back to what the member submitted. */
  upiReference?: string | null;
  /** Recorded against a new member's consent. Null — the owner confirms server-side. */
  consentIp: string | null;
}): Promise<FulfilResult> {
  const { join } = params;

  // isActive is deliberately NOT filtered: the plan was active when the request
  // was created, so a plan retired since must still be honoured.
  const planRows = await db
    .select()
    .from(membershipPlans)
    .where(
      and(
        eq(membershipPlans.branchId, join.branchId),
        eq(membershipPlans.code, join.planCode as any)
      )
    )
    .limit(1);

  const plan = planRows[0];
  if (!plan) {
    console.error(
      `[Payments] plan ${join.planCode} missing for branch ${join.branchId} on manual join ${join.id} — defaulting to 30 days`
    );
  }

  const durationDays = plan?.durationDays || 30;
  // The gym's calendar day, not the server's. See istDateString in lib/utils.
  const todayStr = istDateString();
  const planType = (
    join.planCode.includes("no_cardio") ? "no_cardio" : "full"
  ) as any;

  const upiReference = params.upiReference?.trim() || join.upiReference || null;

  let outcome: { memberId: number; gymId: number; newExpiryStr: string };

  // ===== ONE TRANSACTION FOR ALL FOUR WRITES ===== (see fulfilPaidJoin for why)
  try {
    outcome = await db.transaction(async (tx) => {
      let memberId: number;
      let gymId: number;
      let newExpiryStr: string;

      // Claim inside the transaction. Accept both pre-states: "claimed" (the
      // member tapped "I've paid") and "pending" (the owner saw the money land
      // before the member clicked anything). Whichever confirm arrives second
      // matches zero rows here.
      const claimed = await tx
        .update(onlineJoins)
        .set({ status: "paid", confirmedAt: new Date(), upiReference })
        .where(
          and(
            eq(onlineJoins.id, join.id),
            inArray(onlineJoins.status, ["pending", "claimed"])
          )
        )
        .returning({ id: onlineJoins.id });

      if (claimed.length === 0) {
        throw new JoinAlreadyClaimedError();
      }

      // ===== EXISTING MEMBER (renewal) =====
      if (join.memberId) {
        const existing = await tx
          .select()
          .from(members)
          .where(
            and(
              eq(members.id, join.memberId),
              eq(members.branchId, join.branchId)
            )
          )
          .limit(1);
        if (!existing.length) throw new Error("Existing member not found");
        const m = existing[0];

        // Both sides are "YYYY-MM-DD", so `>` compares them lexicographically,
        // which for a zero-padded ISO date is the same as comparing the dates.
        // A membership that has not lapsed extends from its own expiry; a
        // lapsed one restarts from today. Done as strings so nothing round-
        // trips through a Date and picks up a timezone shift on the way.
        const base =
          m.membershipExpiry > todayStr ? m.membershipExpiry : todayStr;
        newExpiryStr = addDaysIso(base, durationDays);

        await tx
          .update(members)
          .set({
            membershipExpiry: newExpiryStr,
            feeAmount: join.amount,
            planType,
            leftGym: false,
            wonBackAt: m.leftGym ? new Date() : m.wonBackAt,
          })
          .where(eq(members.id, m.id));

        memberId = m.id;
        gymId = m.gymId;
      }
      // ===== NEW MEMBER =====
      else {
        const parentName = join.parentName?.trim() || null;
        const emergencyContact =
          join.emergencyContact?.trim() || join.contactNumber;

        if (!parentName) {
          console.error(
            `[Payments] manual join ${join.id} completed without a parent name — fill it in from the admin panel`
          );
        }

        newExpiryStr = addDaysIso(todayStr, durationDays);

        const inserted = await insertMemberWithNextGymId(tx, {
          branchId: join.branchId,
          name: join.name,
          email: join.email,
          contactNumber: join.contactNumber,
          address: join.address,
          parentName,
          emergencyContact,
          feeAmount: join.amount,
          joiningDate: todayStr,
          membershipExpiry: newExpiryStr,
          planType,
          consentToHealthData: true,
          consentDate: new Date(),
          consentIpAddress: params.consentIp,
        });

        memberId = inserted.id;
        gymId = inserted.gymId;
      }

      // ===== RECORD PAYMENT ===== (UPI, no gateway ids)
      await tx.insert(payments).values({
        branchId: join.branchId,
        memberId,
        amount: join.amount,
        date: todayStr,
        method: "upi",
      });

      // ===== LINK THE JOIN TO THE MEMBER =====
      await tx
        .update(onlineJoins)
        .set({ memberId })
        .where(eq(onlineJoins.id, join.id));

      return { memberId, gymId, newExpiryStr };
    });
  } catch (e) {
    if (e instanceof JoinAlreadyClaimedError) {
      return {
        ok: false,
        code: "claimed",
        error: "This request has already been confirmed.",
      };
    }
    console.error(`[Payments] manual join ${join.id} failed on confirm:`, e);
    return {
      ok: false,
      code: "failed",
      error:
        "Couldn't activate the membership. Nothing was charged again — try Confirm once more, or check the member manually.",
    };
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin");
  revalidatePath("/admin/join-requests");

  return {
    ok: true,
    memberId: outcome.memberId,
    gymId: outcome.gymId,
    expiry: outcome.newExpiryStr,
    amount: join.amount,
    memberName: join.name,
    planName: plan?.name,
    contactNumber: join.contactNumber,
  };
}

