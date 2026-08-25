"use server";

import Razorpay from "razorpay";
import crypto from "crypto";
import { db } from "@/db";
import { members, payments, onlineJoins, membershipPlans, branches } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { checkRateLimit, getClientInfo } from "@/lib/security";
import { sanitizeError } from "@/lib/errors";
import { fulfilPaidJoin } from "@/lib/fulfil-join";

/**
 * Razorpay's Key ID is the same value whether it is read from RAZORPAY_KEY_ID or
 * NEXT_PUBLIC_RAZORPAY_KEY_ID — it identifies the account and is meant to be
 * public, since checkout.js needs it in the browser. The server-only name is
 * preferred here (env-check validates that one) with the public name as a
 * fallback, so the SDK works whichever of the two is set.
 *
 * KEY_SECRET is the one that must never gain a NEXT_PUBLIC_ prefix: it signs
 * orders and verifies payment signatures.
 */
function getRazorpay() {
  // A placeholder counts as unset. Left as-is, "rzp_test_xxxxxxxxxx" is a
  // non-empty string, so `||` treats it as a real value, skips the fallback,
  // and Razorpay answers with a bare 401 "Authentication failed" that says
  // nothing about which variable is wrong. Fail here with a useful message.
  const isPlaceholder = (v?: string) => !v || /x{4,}/i.test(v);

  const key_id = [process.env.RAZORPAY_KEY_ID, process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID]
    .find((v) => !isPlaceholder(v));
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id) {
    throw new Error(
      "Razorpay key ID is missing or still a placeholder — set RAZORPAY_KEY_ID in .env"
    );
  }
  if (isPlaceholder(key_secret)) {
    throw new Error(
      "Razorpay key secret is missing or still a placeholder — set RAZORPAY_KEY_SECRET in .env"
    );
  }
  return new Razorpay({ key_id, key_secret });
}

// ============= GET PUBLIC PLANS (per branch) =============
export async function getPublicBranches() {
  try {
    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.id);
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      address: b.address,
      phone: b.phone,
    }));
  } catch {
    return [];
  }
}

export async function getPublicPlansForBranch(branchId: number) {
  try {
    const rows = await db
      .select()
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.branchId, branchId),
          eq(membershipPlans.isActive, true)
        )
      )
      .orderBy(membershipPlans.displayOrder);

    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      durationDays: p.durationDays,
      description: p.description,
      includesCardio: p.includesCardio,
    }));
  } catch {
    return [];
  }
}

// ============= PHONE NORMALISATION =============
/**
 * Reduce an Indian phone number to its 10 significant digits.
 *
 * Strips everything that isn't a digit (spaces, dashes, brackets, a leading +)
 * and then drops a 91 country prefix ONLY when doing so leaves exactly 10
 * digits. The old code stripped `^\+91` and `^91` in sequence against the raw
 * string, which chewed real digits off numbers that legitimately start with 91
 * and — worse — let "+919112345" collapse to "12345", so a caller only had to
 * guess the last 5 digits of a member's number.
 *
 * Returns null when the input isn't a plausible 10-digit Indian mobile.
 */
function normalisePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  return local.length === 10 ? local : null;
}

// ============= LOOKUP EXISTING MEMBER (branch-aware) =============
export async function lookupMemberSecure(
  gymIdRaw: string,
  phoneRaw: string,
  branchId: number
) {
  const gymId = parseInt(gymIdRaw);

  if (!branchId) return { error: "Please select a branch first" };
  if (!gymId) return { error: "Enter your Gym ID" };

  const phone = normalisePhone(phoneRaw);
  if (!phone) return { error: "Enter your registered 10-digit phone number" };

  // One generic reply for "no such member" AND "phone doesn't match". Two
  // distinct messages let anyone walk gymId = 1, 2, 3... and learn exactly
  // which IDs exist and how many members a branch has, before brute-forcing
  // the phone. Gym IDs are sequential from 1, so that walk is trivial.
  const GENERIC = {
    error: "We couldn't match that Gym ID and phone number. Please check both.",
  };

  // Rate limited because this is the brute-force target: 10 digits is only
  // feasible to guess if the attempt is unmetered.
  const { ip } = await getClientInfo();
  const rl = await checkRateLimit(`lookup:${ip}`);
  if (!rl.allowed) {
    return {
      error: `Too many attempts. Try again in ${rl.blockMinutesLeft} minutes.`,
    };
  }

  try {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.gymId, gymId), eq(members.branchId, branchId)))
      .limit(1);

    if (rows.length === 0) return GENERIC;

    const m = rows[0];
    const storedPhone = normalisePhone(m.contactNumber);

    // Full 10-digit comparison. The old check used endsWith() against a
    // possibly-shorter input, which is what made partial numbers pass.
    if (!storedPhone || storedPhone !== phone) return GENERIC;

    return {
      success: true,
      member: {
        id: m.id,
        gymId: m.gymId,
        branchId: m.branchId,
        name: m.name,
        contactNumber: "XXXXXX" + m.contactNumber.slice(-4),
        currentExpiry: m.membershipExpiry,
        lastPlan: m.planType,
      },
    };
  } catch (e) {
    return { error: sanitizeError(e, "Lookup failed") };
  }
}

// ============= CREATE ONLINE JOIN ORDER =============
export async function createOnlineJoinOrder(formData: FormData) {
  const consentToHealthData = formData.get("consentToHealthData") === "true";
  if (!consentToHealthData) {
    return { error: "You must accept the Privacy Policy and Terms to proceed." };
  }

  const { ip } = await getClientInfo();
  const rl = await checkRateLimit(`join:${ip}`);
  if (!rl.allowed) {
    return {
      error: `Too many attempts. Try again in ${rl.blockMinutesLeft} minutes.`,
    };
  }

  const branchId = Number(formData.get("branchId"));
  const joinType = String(formData.get("joinType") || "new");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const contactNumber = String(formData.get("contactNumber") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const parentName = String(formData.get("parentName") || "").trim();
  const emergencyContact = String(formData.get("emergencyContact") || "").trim();
  const planCode = String(formData.get("planCode") || "");
  const existingMemberId = formData.get("existingMemberId")
    ? Number(formData.get("existingMemberId"))
    : null;

  if (!branchId) return { error: "Please select a branch" };
  if (!name) return { error: "Name is required" };
  if (!contactNumber) return { error: "Contact number is required" };
  if (!address) return { error: "Address is required" };
  if (!parentName) return { error: "Parent / Father name is required" };
  if (!emergencyContact) return { error: "Emergency contact is required" };

  try {
    // ===== RESOLVE THE RENEWAL TARGET, SERVER-SIDE =====
    // existingMemberId arrives from the browser, so it cannot be trusted on its
    // own. The "verify your ID and phone first" gate lives in the client
    // component, which anyone can skip by posting this action directly. Without
    // the checks below, a renewal could be pointed at any member row in any
    // branch: the payment lands on someone else's membership and the verify
    // response reads back their gym ID and expiry.
    //
    // Re-proving the phone number here is the same proof lookupMemberSecure
    // asks for, applied at the point where it actually binds to a write.
    let verifiedMemberId: number | null = null;

    // The join form posts "renewal"; older callers said "existing". Both are
    // accepted so neither spelling silently falls through to the new-member
    // path and creates a duplicate record.
    const isRenewal = joinType === "renewal" || joinType === "existing";

    if (isRenewal) {
      if (!existingMemberId) {
        return { error: "Please verify your Gym ID and phone number first" };
      }

      const target = await db
        .select()
        .from(members)
        .where(
          and(eq(members.id, existingMemberId), eq(members.branchId, branchId))
        )
        .limit(1);

      const submittedPhone = normalisePhone(contactNumber);
      const storedPhone = target.length
        ? normalisePhone(target[0].contactNumber)
        : null;

      if (
        !target.length ||
        !submittedPhone ||
        !storedPhone ||
        submittedPhone !== storedPhone
      ) {
        return {
          error:
            "We couldn't match that membership. Please verify your Gym ID and phone number again.",
        };
      }

      verifiedMemberId = target[0].id;
    }

    // Fetch plan from DB
    const planRows = await db
      .select()
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.branchId, branchId),
          eq(membershipPlans.code, planCode as any),
          eq(membershipPlans.isActive, true)
        )
      )
      .limit(1);

    if (planRows.length === 0) {
      return { error: "Selected plan is not available for this branch" };
    }

    const plan = planRows[0];
    const branchRow = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
    const branchCode = branchRow[0]?.code || "BG";

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: plan.price * 100,
      currency: "INR",
      receipt: `BG-${branchCode}-${Date.now()}`,
      notes: {
        plan: plan.code,
        planName: plan.name,
        branchId: String(branchId),
        branchCode,
        name,
        contactNumber,
        joinType,
      },
    });

    const join = await db
      .insert(onlineJoins)
      .values({
        branchId,
        name,
        email: email || null,
        contactNumber,
        address,
        planCode: plan.code,
        amount: plan.price,
        status: "pending",
        razorpayOrderId: order.id,
        memberId: verifiedMemberId,
        // Persisted here, where they have just been validated, so fulfilment
        // never depends on the browser handing them back. The webhook path has
        // no browser to ask.
        parentName,
        emergencyContact,
      })
      .returning();

    return {
      success: true,
      orderId: order.id,
      amount: plan.price * 100,
      currency: "INR",
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      joinId: join[0].id,
      planName: plan.name,
      planDurationDays: plan.durationDays,
      branchName: branchRow[0]?.name || "",
      customer: { name, email, contact: contactNumber },
      // Nothing about the membership round trips through the browser any more.
      // parentName and emergencyContact were the last two, and they now live on
      // the join row alongside the routing fields (joinType, existingMemberId,
      // branchId) that were moved there earlier.
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to create payment order") };
  }
}

// ============= SIGNATURE COMPARISON =============
/**
 * Constant-time comparison of two hex signatures.
 *
 * A plain `!==` on strings stops at the first differing character, so how long
 * the rejection takes leaks how many leading characters were correct. Given
 * enough attempts that is enough to walk a valid signature out one character at
 * a time. timingSafeEqual requires equal-length buffers, so the length is
 * checked first — the length of an HMAC-SHA256 hex digest is not a secret.
 */

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received || "", "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============= VERIFY PAYMENT =============
/**
 * Everything that decides WHO gets the membership and WHAT it costs is read
 * from the onlineJoins row, not from this payload. joinType, existingMemberId
 * and branchId used to be accepted here and are deliberately gone: they were
 * client-controlled inputs to a privileged write. parentName and emergencyContact
 * remain because they are the caller's own details being recorded, not an
 * authorisation decision.
 */
export async function verifyOnlinePayment(data: {
  joinId: number;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  parentName?: string;
  emergencyContact?: string;
}) {
  // Metered so a stolen signature can't be replayed across joinIds in a tight
  // loop, and so a flood of bogus callbacks can't hammer the database.
  const { ip } = await getClientInfo();
  const rl = await checkRateLimit(`verify:${ip}`);
  if (!rl.allowed) {
    return {
      error: `Too many attempts. Try again in ${rl.blockMinutesLeft} minutes.`,
    };
  }

  try {
    const body = `${data.razorpay_order_id}|${data.razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body)
      .digest("hex");

    if (!signaturesMatch(expected, data.razorpay_signature)) {
      return { error: "Payment verification failed" };
    }

    const joins = await db
      .select()
      .from(onlineJoins)
      .where(eq(onlineJoins.id, data.joinId))
      .limit(1);
    if (!joins.length) return { error: "Join request not found" };

    const join = joins[0];

    // ===== BIND THE SIGNATURE TO THIS JOIN =====
    // This MUST come before the idempotency guard below. The HMAC above only
    // proves razorpay_order_id and razorpay_payment_id belong together — it says
    // nothing about joinId, which the caller supplies freely. While this check
    // sat after the "already paid" early return, anyone who had paid once could
    // replay their own valid triple against joinId = 1, 2, 3... and read back
    // every paid member's name, phone number, gym ID and expiry.
    if (join.razorpayOrderId !== data.razorpay_order_id) {
      return { error: "Payment verification failed" };
    }

    // ===== IDEMPOTENCY GUARD =====
    // A valid signature verifies every time, so a retried/double-submitted
    // callback must not create a second member/payment or extend expiry twice.
    // If this join was already processed, return its result without side effects.
    if (join.status === "paid") {
      const priorMember = join.memberId
        ? (
            await db
              .select()
              .from(members)
              .where(eq(members.id, join.memberId))
              .limit(1)
          )[0]
        : null;
      return {
        success: true,
        gymId: priorMember?.gymId ?? 0,
        expiry: priorMember?.membershipExpiry ?? "",
        amount: join.amount,
        memberName: join.name,
        // Masked to match lookupMemberSecure. The success screen only needs
        // enough digits for the member to recognise their own number.
        contactNumber: "XXXXXX" + join.contactNumber.slice(-4),
        alreadyProcessed: true,
      };
    }

    // ===== CONFIRM THE MONEY ACTUALLY ARRIVED =====
    // The signature only proves Razorpay sent this order/payment pair — it does
    // not prove the payment succeeded. A failed, pending or later-refunded
    // payment still carries a valid signature, so without this call a membership
    // could be granted against money the gym never received. Asked of Razorpay's
    // API directly, so a tampered client response cannot fake it.
    let paymentAmountPaise: number;
    try {
      const razorpay = getRazorpay();
      const payment = await razorpay.payments.fetch(data.razorpay_payment_id);

      if (payment.status !== "captured" && payment.status !== "authorized") {
        return {
          error:
            "This payment has not completed. If money left your account, contact us and we'll sort it out.",
        };
      }
      if (payment.order_id !== join.razorpayOrderId) {
        return { error: "Payment verification failed" };
      }

      paymentAmountPaise = Number(payment.amount);
    } catch (e) {
      console.error("[Razorpay] payments.fetch failed:", e);
      return {
        error:
          "We couldn't confirm your payment with Razorpay. Don't pay again — contact us and we'll activate it manually.",
      };
    }

    // Guards against a join row whose price changed between order and capture,
    // then does every write. Shared with the Razorpay webhook so a payment is
    // fulfilled identically whether the browser or Razorpay tells us about it.
    const { ip: consentIp } = await getClientInfo();

    const result = await fulfilPaidJoin({
      join,
      razorpayOrderId: data.razorpay_order_id,
      razorpayPaymentId: data.razorpay_payment_id,
      paidAmountPaise: paymentAmountPaise,
      parentName: data.parentName,
      emergencyContact: data.emergencyContact,
      consentIp,
      source: "browser",
    });

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      success: true,
      gymId: result.gymId,
      expiry: result.expiry,
      amount: result.amount,
      memberName: result.memberName,
      planName: result.planName,
      contactNumber: result.contactNumber,
    };
  } catch (e) {
    return { error: sanitizeError(e, "Verification failed") };
  }
}
