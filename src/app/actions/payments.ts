"use server";

import Razorpay from "razorpay";
import crypto from "crypto";
import { Resend } from "resend";
import { db } from "@/db";
import { members, payments, onlineJoins, membershipPlans, branches } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { checkRateLimit, checkDailyEmailCap, getClientInfo } from "@/lib/security";
import { sanitizeError } from "@/lib/errors";
import { verifyTurnstile } from "@/lib/turnstile";
import { fulfilPaidJoin } from "@/lib/fulfil-join";
import { notifyJoinConfirmed } from "@/lib/join-notify";
import { deriveJoinReference, parseJoinReference } from "@/lib/manual-join";
import {
  createStatusPollToken,
  verifyStatusPollToken,
} from "@/lib/join-proof";
import {
  fromHeader,
  ownerNewJoinAlertEmail,
  joinReceivedEmail,
} from "@/lib/email-templates";
import { razorpayAccountFor } from "@/lib/razorpay-account";

/**
 * Razorpay SDK client for the account that receives a given branch's money.
 *
 * Takes a branch code rather than reading a global key pair because the two
 * branches have different owners and therefore two separate merchant accounts.
 * All the resolution rules — including the deliberate refusal to fall back to a
 * global key once any per-branch key exists — live in razorpay-account.ts, so
 * this stays a one-liner and there is exactly one place that decides whose bank
 * account a payment lands in.
 */
function getRazorpay(branchCode: string) {
  const account = razorpayAccountFor(branchCode);
  return new Razorpay({ key_id: account.keyId, key_secret: account.keySecret });
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

/**
 * Format checks shared by the two public join entry points.
 *
 * Both actions already check that these fields are *present*. Presence was not
 * enough: "asdf" passed as a contact number, and an uncallable lead is
 * indistinguishable from a lost one — the number is the whole reason the row
 * exists. Phones go through normalisePhone, the same function the renewal match
 * uses, so a number accepted here is a number that can be matched later.
 *
 * Email is deliberately optional. Plenty of walk-in members do not have one,
 * and notifyMemberOfLead already skips the send when it is blank — so validate
 * only what was actually typed. Without this, a typo means the confirmation
 * silently never arrives, and a hand-crafted request could put anything at all
 * into the Resend recipient field.
 *
 * Returns the error message, or null when everything is fine.
 */
function validateJoinContactFields(fields: {
  contactNumber: string;
  emergencyContact: string;
  email: string;
}): string | null {
  if (!normalisePhone(fields.contactNumber)) {
    return "Enter a valid 10-digit mobile number";
  }
  if (!normalisePhone(fields.emergencyContact)) {
    return "Enter a valid 10-digit emergency contact number";
  }
  if (fields.email) {
    if (
      fields.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(fields.email)
    ) {
      return "Enter a valid email address, or leave it blank";
    }
  }
  return null;
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

  const fieldError = validateJoinContactFields({
    contactNumber,
    emergencyContact,
    email,
  });
  if (fieldError) return { error: fieldError };

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
    // No "BG" fallback any more. The branch code now selects WHICH owner's
    // Razorpay account receives this money, so an invented default is not a
    // harmless placeholder — it decides who gets paid. Fail instead.
    const branchCode = branchRow[0]?.code;
    if (!branchCode) return { error: "Please select a branch" };

    // Resolved once and reused: the client signs the order, and the same
    // account's public key ID goes back to the browser so checkout.js opens
    // against the right merchant.
    const account = razorpayAccountFor(branchCode);
    const razorpay = new Razorpay({
      key_id: account.keyId,
      key_secret: account.keySecret,
    });
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
      // This branch's own account, not a global NEXT_PUBLIC_ value. Reading it
      // from a build-time public env var would open every branch's checkout
      // against the same merchant regardless of which gym was chosen.
      key: account.keyId,
      joinId: join[0].id,
      planName: plan.name,
      planDurationDays: plan.durationDays,
      branchName: branchRow[0]?.name || "",
      customer: { name, email, contact: contactNumber },
      // ===== ENOUGH TO FALL BACK WITHOUT A SECOND ROW =====
      // If checkout.js can't be opened, or the member closes the modal without
      // paying, the client shows the contact-the-owner screen for THIS join
      // rather than calling createJoinLead — which would leave the owner two
      // rows for one person. These are the fields that screen needs.
      reference: deriveJoinReference(branchCode, join[0].id),
      planPrice: plan.price,
      branchPhone: branchRow[0]?.phone || null,
      branchAddress: branchRow[0]?.address || "",
      isRenewal,
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
 * Spelled out rather than left to inference, because the two success paths are
 * not the same shape: the already-processed early return has no plan name and
 * sends no email, while a fresh fulfilment has both. Inferred, TypeScript folds
 * them into one type where every field is possibly-undefined, and the caller
 * ends up assigning `number | undefined` into a `number`.
 *
 * `error?: undefined` on the success arm is what makes the caller's plain
 * `if (result.error) return;` both compile and narrow — without it, `.error`
 * cannot be read off a union whose other member has no such property.
 */
export type VerifyFailure = { error: string; success?: undefined };

export type VerifySuccess = {
  success: true;
  error?: undefined;
  gymId: number;
  expiry: string;
  amount: number;
  memberName: string;
  planName?: string;
  contactNumber: string;
  /** Only on the replayed-callback path; the membership already existed. */
  alreadyProcessed?: true;
  /** Address the Gym ID went to, or null when they gave none / it bounced. */
  emailedTo?: string | null;
};

export type VerifyResult = VerifySuccess | VerifyFailure;

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
}): Promise<VerifyResult> {
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
    // ===== LOAD THE JOIN BEFORE VERIFYING =====
    // This used to happen after the signature check, because the signing secret
    // was one global value. With per-branch accounts the correct secret depends
    // on which branch the join belongs to, so the row must be read first.
    //
    // The "not found" case deliberately returns the SAME generic string as a
    // signature failure. Distinguishing them would turn this action into a
    // join-ID enumeration oracle: post any garbage signature against joinId
    // 1, 2, 3… and "Join request not found" vs "Payment verification failed"
    // maps out precisely which joins exist. That is the same class of leak the
    // order-binding check further down was added to close, so reordering must
    // not quietly reopen it.
    const joins = await db
      .select()
      .from(onlineJoins)
      .where(eq(onlineJoins.id, data.joinId))
      .limit(1);
    if (!joins.length) return { error: "Payment verification failed" };

    const join = joins[0];

    // Whose account signed this payment. Read from the join row — a record this
    // server created — and never from the caller's payload, which would let a
    // caller nominate the branch whose secret their signature is checked against.
    const branchRow = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, join.branchId))
      .limit(1);
    const branchCode = branchRow[0]?.code;
    if (!branchCode) return { error: "Payment verification failed" };

    const account = razorpayAccountFor(branchCode);

    const body = `${data.razorpay_order_id}|${data.razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", account.keySecret)
      .update(body)
      .digest("hex");

    if (!signaturesMatch(expected, data.razorpay_signature)) {
      return { error: "Payment verification failed" };
    }

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
      const razorpay = getRazorpay(branchCode);
      const payment = await razorpay.payments.fetch(data.razorpay_payment_id);

      // Only "captured" counts. "authorized" means Razorpay is holding the
      // funds but they have not moved — the hold can expire or be voided, and
      // the money never lands. The webhook refuses to act on it for the same
      // reason (api/webhooks/razorpay/[branch]/route.ts). If auto-capture is
      // off in the Razorpay dashboard, accepting it here hands out a
      // membership against money the gym never receives.
      if (payment.status !== "captured") {
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

    // ===== GYM ID DELIVERY =====
    // Only the compare-and-swap winner reaches here, so the webhook arriving for
    // the same payment a second later sends nothing — exactly one email per
    // membership. Sent only if the member gave an address; never throws.
    const notify = await notifyJoinConfirmed({
      email: join.email,
      branchId: join.branchId,
      memberName: result.memberName,
      gymId: result.gymId,
      planName: result.planName,
      amount: result.amount,
      expiry: result.expiry,
      contactNumber: result.contactNumber,
      isRenewal: Boolean(join.memberId),
    });

    return {
      success: true,
      gymId: result.gymId,
      expiry: result.expiry,
      amount: result.amount,
      memberName: result.memberName,
      planName: result.planName,
      contactNumber: result.contactNumber,
      // Lets the success screen say where the copy went. Deliberately NOT a
      // wa.me link: the only number we hold is the member's own, so handing them
      // one would open a chat with themselves. The owner gets the one-tap link
      // from the admin panel instead.
      emailedTo: notify.emailSent ? join.email : null,
    };
  } catch (e) {
    return { error: sanitizeError(e, "Verification failed") };
  }
}

// ============================================================================
// FALLBACK JOIN FLOW  —  the lead queue
// ============================================================================
// Razorpay is the payment method. This is what happens when it can't run: the
// gateway is off for the site (PAYMENT_MODE=contact), the order call failed, or
// checkout.js never loaded in the member's browser.
//
// NO MONEY MOVES HERE. There is no UPI ID on screen, no QR code, no amount to
// transfer, and nothing for the member to claim afterwards. The member's details
// are saved so the effort of filling the form isn't wasted, they get a reference
// and the branch's phone/WhatsApp, and the payment happens the way it did before
// this website existed — in person or over the phone with the owner.
//
// That is why the owner alert fires the moment the lead is created rather than
// when the member says they've paid: the member never says anything. The lead
// sits in the owner's Join Requests queue, they call, they take the money, they
// confirm. The write half of that confirm lives in src/lib/fulfil-join.ts
// (fulfilManualJoin); the confirm/reject actions live in
// src/app/actions/join-requests.ts.

/**
 * Save a join lead and hand back what the contact screen needs.
 *
 * Mirrors createOnlineJoinOrder — same validation, same server-side renewal
 * re-proof, same active-plan lookup — but writes no Razorpay order and takes no
 * payment. Row status is "pending", which now means exactly "form filled, money
 * not collected".
 */
export async function createJoinLead(formData: FormData) {
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

  // ===== CAPTCHA =====
  // This action sends two emails per call, and Resend's allowance is shared
  // with the owner's login OTP — so someone scripting this form can lock the
  // owner out of the admin panel without ever guessing a password. The IP rate
  // limit above does not stop that: IPs are free and rotate.
  //
  // Ordered after the rate limit and before anything else, matching
  // requestPasswordReset. Every other public entry point already verifies
  // Turnstile (auth.ts, otp.ts, password-reset.ts); this form did not.
  //
  // Deliberately NOT added to createOnlineJoinOrder above, even though it is
  // the same form: a Turnstile token is single-use, and handleContinue falls
  // back to this action when the order call fails. Guarding both would spend
  // the token on the gateway attempt and then reject the fallback, throwing
  // away a filled form at exactly the moment it matters. The gateway path also
  // sends no email, so it cannot burn the quota this check exists to protect.
  const captchaToken = String(formData.get("captchaToken") || "");
  const captchaResult = await verifyTurnstile(captchaToken, ip);
  if (!captchaResult.success) {
    return { error: captchaResult.error || "Captcha verification failed." };
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

  const fieldError = validateJoinContactFields({
    contactNumber,
    emergencyContact,
    email,
  });
  if (fieldError) return { error: fieldError };

  try {
    // ===== RESOLVE THE RENEWAL TARGET, SERVER-SIDE =====
    // Identical proof to createOnlineJoinOrder: existingMemberId comes from the
    // browser and can't be trusted, so re-prove the phone before binding a
    // renewal to a member row — otherwise a renewal could target anyone's
    // membership.
    let verifiedMemberId: number | null = null;
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

    // Fetch plan from DB (must be active to be joinable).
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

    const branchRow = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    const branch = branchRow[0];
    // NO "BG" FALLBACK — the same refusal as createOnlineJoinOrder at :329-333,
    // for an additional reason.
    //
    // The branch code is half the member's reference (`BG-NR-000123`), and
    // getJoinStatus re-checks the code the member typed against the row's real
    // branch before it will show anything (:1071-1076). A lead saved with the
    // placeholder therefore gets `BG-BG-000123`, which matches no branch and can
    // never be looked up again: the member is handed a reference the status page
    // rejects, and the owner's alert email quotes the same dead string. Refusing
    // the lead is better than recording one nobody can find — and the plan
    // lookup just above already proves a plan exists for this branchId, so this
    // only fires if the branch vanished between the two queries.
    if (!branch?.code) return { error: "Please select a branch" };
    const branchCode = branch.code;

    // Save the lead. No Razorpay order — there is nothing to charge here. The row
    // exists so the owner has someone to call, and so the member's details
    // survive whatever went wrong with the gateway.
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
        memberId: verifiedMemberId,
        parentName,
        emergencyContact,
      })
      .returning();

    const joinId = join[0].id;
    const reference = deriveJoinReference(branchCode, joinId);

    // ===== TELL BOTH SIDES, NOW =====
    // This used to fire when the member submitted a payment screenshot. There is
    // no screenshot step any more, and no "I've paid" tap either — so if the
    // owner isn't told at lead creation they are never told at all, and someone
    // who filled the whole form sits in the queue unnoticed.
    //
    // Awaited but best-effort: a serverless invocation can be frozen the moment
    // this action returns, so fire-and-forget could drop the send mid-flight —
    // and neither email failing may fail the lead, which is already committed.
    // The member's copy is skipped entirely when they gave no address (the field
    // is optional, and unsent mail costs no quota).
    try {
      await notifyOwnerOfLead(join[0]);
    } catch (e) {
      console.error("[JoinLead] owner alert failed:", e);
    }
    try {
      await notifyMemberOfLead(
        join[0],
        reference,
        branch?.name || "",
        branch?.phone || null,
        plan.name
      );
    } catch (e) {
      console.error("[JoinLead] member acknowledgement failed:", e);
    }

    revalidatePath("/admin/join-requests");

    return {
      success: true,
      joinId,
      reference,
      amount: plan.price,
      planName: plan.name,
      planDurationDays: plan.durationDays,
      branchName: branch?.name || "",
      branchPhone: branch?.phone || null,
      // The contact screen tells them where to walk in, so it needs the address.
      branchAddress: branch?.address || "",
      email: email || null,
      isRenewal,
    };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to save your details") };
  }
}

/**
 * Best-effort email to the branch owner that a join lead needs a phone call.
 * Not exported (this file is "use server", so every export is a public endpoint)
 * and the caller wraps it in try/catch — a failed ping must never fail the lead.
 */
async function notifyOwnerOfLead(join: typeof onlineJoins.$inferSelect) {
  const branchRow = await db
    .select()
    .from(branches)
    .where(eq(branches.id, join.branchId))
    .limit(1);
  const branch = branchRow[0];
  const ownerEmail = branch?.ownerEmail?.trim();
  // `!branch` is redundant at runtime — no branch means no ownerEmail — but it
  // is what lets the reference below be built from `branch.code` instead of
  // `branch?.code || "BG"`. That placeholder would have put an unlookupable
  // `BG-BG-nnnnnn` in the owner's alert; see the note in createJoinLead.
  if (!branch || !ownerEmail) return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || /x{4,}/i.test(apiKey)) return; // unset or still a placeholder

  // ===== DAILY CAP =====
  // Resend's allowance is shared with the owner's login OTP, so an unbounded
  // alert here is a way to lock the owner out of the admin panel without ever
  // guessing a password. The captcha in createJoinLead is the front door; this
  // is the backstop.
  //
  // Capped under its OWN identifier, deliberately not the owner's address:
  // checkDailyEmailCap keys on `email-daily:<address>`, which is exactly the
  // key the owner's OTP uses. Capping on ownerEmail would mean 30 join alerts
  // spend the OTP quota and cause the lockout this check is here to prevent.
  //
  // 30/day per branch is far above a real day's joins and far below the point
  // where the allowance is in danger. A suppressed alert costs the owner
  // nothing structural: the lead is already written and still shows up in the
  // Join Requests queue, which is where leads are actually worked.
  const alertCap = await checkDailyEmailCap(`join-alert:${join.branchId}`, 30);
  if (!alertCap.allowed) return;

  // Prefer the plan's display name; fall back to the stored code.
  const planRow = await db
    .select({ name: membershipPlans.name })
    .from(membershipPlans)
    .where(
      and(
        eq(membershipPlans.branchId, join.branchId),
        eq(membershipPlans.code, join.planCode as any)
      )
    )
    .limit(1);

  const reference = deriveJoinReference(branch.code, join.id);
  const { subject, html, text } = ownerNewJoinAlertEmail({
    memberName: join.name,
    contactNumber: join.contactNumber,
    amount: join.amount,
    branchName: branch.name,
    reference,
    isRenewal: Boolean(join.memberId),
    planName: planRow[0]?.name,
  });

  await new Resend(apiKey).emails.send({
    from: fromHeader(),
    to: ownerEmail,
    subject,
    html,
    text,
  });
}

/**
 * Best-effort "we've got your details, the gym will call you" email to the
 * MEMBER. Not exported for the same reason as notifyOwnerOfLead — every export of
 * a "use server" module is a public endpoint — and the caller wraps it, because a
 * failed email must never fail the lead.
 *
 * The `if (!join.email)` guard is the whole email budget in one line: the address
 * is optional on the join form, and no address means no send rather than a
 * throwaway attempt against the 3,000/month allowance.
 *
 * Note this cannot actually reach members until the sending domain is verified in
 * Resend (the shared sender only delivers to the Resend account owner). It is
 * written and wired now so that switching FROM_EMAIL is the only step left; the
 * status page carries the reassurance in the meantime.
 */
async function notifyMemberOfLead(
  join: typeof onlineJoins.$inferSelect,
  reference: string,
  branchName: string,
  branchPhone: string | null,
  planName?: string
) {
  if (!join.email) return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || /x{4,}/i.test(apiKey)) return;

  // Per-address cap, the same one login uses. This is the relay leg: without
  // it, someone submitting the form repeatedly with a third party's address
  // turns the join form into a way to mail a stranger on the gym's reputation
  // and the gym's quota. 10/day/address (the default) is generous for someone
  // legitimately re-submitting after a mistake.
  const memberCap = await checkDailyEmailCap(join.email);
  if (!memberCap.allowed) return;

  const { subject, html, text } = joinReceivedEmail({
    memberName: join.name,
    reference,
    amount: join.amount,
    planName,
    branchName,
    branchPhone,
    isRenewal: Boolean(join.memberId),
  });

  await new Resend(apiKey).emails.send({
    from: fromHeader(),
    to: join.email,
    subject,
    html,
    text,
  });
}

/**
 * Self-serve status check for the member. Public and rate-limited, with a single
 * GENERIC error for every failure (mirrors lookupMemberSecure) so the endpoint
 * can't be walked to discover which references exist. The reference locates the
 * row; the phone number is the proof.
 */
export async function getJoinStatus(data: { reference: string; phone: string }) {
  const GENERIC = {
    error:
      "We couldn't find a request matching that reference and phone number. Please check both.",
  };

  const { ip } = await getClientInfo();
  const rl = await checkRateLimit(`joinstatus:${ip}`);
  if (!rl.allowed) {
    return {
      error: `Too many attempts. Try again in ${rl.blockMinutesLeft} minutes.`,
    };
  }

  const parsed = parseJoinReference(data.reference);
  const phone = normalisePhone(data.phone);
  if (!parsed || !phone) return GENERIC;

  try {
    // Column list rather than select(): a `select()` here would drag proofImage
    // (~80KB of base64) into the action on every status check, to be used for
    // nothing but a boolean.
    const joins = await db
      .select({
        id: onlineJoins.id,
        branchId: onlineJoins.branchId,
        name: onlineJoins.name,
        contactNumber: onlineJoins.contactNumber,
        amount: onlineJoins.amount,
        status: onlineJoins.status,
        memberId: onlineJoins.memberId,
        claimedAt: onlineJoins.claimedAt,
        proofUploadedAt: onlineJoins.proofUploadedAt,
      })
      .from(onlineJoins)
      .where(eq(onlineJoins.id, parsed.joinId))
      .limit(1);
    if (!joins.length) return GENERIC;
    const join = joins[0];

    const branchRow = await db
      .select()
      .from(branches)
      .where(eq(branches.id, join.branchId))
      .limit(1);
    const branch = branchRow[0];

    // The branch code the member typed must match the row's real branch, and the
    // phone must match — either failing returns the same generic error, so a
    // typo'd reference that happens to hit a real id still reveals nothing.
    if (
      !branch ||
      parsed.branchCode.toUpperCase() !== branch.code.toUpperCase()
    ) {
      return GENERIC;
    }
    const storedPhone = normalisePhone(join.contactNumber);
    if (!storedPhone || storedPhone !== phone) return GENERIC;

    // Surface the Gym ID + expiry only once fulfilled.
    let gymId: number | null = null;
    let expiry: string | null = null;
    if (join.status === "paid" && join.memberId) {
      const m = (
        await db
          .select()
          .from(members)
          .where(eq(members.id, join.memberId))
          .limit(1)
      )[0];
      gymId = m?.gymId ?? null;
      expiry = m?.membershipExpiry ?? null;
    }

    return {
      success: true,
      status: join.status,
      reference: deriveJoinReference(branch.code, join.id),
      memberName: join.name,
      amount: join.amount,
      branchName: branch.name,
      branchPhone: branch.phone || null,
      gymId,
      expiry,
      claimedAt: join.claimedAt ? join.claimedAt.toISOString() : null,
      hasProof: Boolean(join.proofUploadedAt),
      // Exchanged here, once, for the reference+phone proof the caller just
      // passed. The status page polls with this instead of re-submitting the
      // phone number on a timer — see pollJoinStatus below.
      pollToken: await createStatusPollToken(join.id),
    };
  } catch (e) {
    return { error: sanitizeError(e, "Status check failed") };
  }
}

/**
 * Re-check a request the caller has ALREADY proved they own, using the signed
 * token getJoinStatus handed back.
 *
 * WHY THIS IS SEPARATE FROM getJoinStatus
 * The status page polls every few seconds so it flips to "confirmed" while the
 * member is watching, which is the single most reassuring thing the site can do
 * while they wait on the owner. It cannot poll getJoinStatus: that action is
 * metered at 5 attempts per 15 minutes with a 30-minute block, so a 20-second
 * poll would lock the member out of checking their own membership inside two
 * minutes.
 *
 * Verifying a signature instead of re-proving identity means this endpoint has no
 * brute-force surface — a token naming someone else's join id cannot be forged —
 * so it can carry a much more generous limit. It still returns only what changes
 * (status, and the Gym ID once there is one), never the member's details, so even
 * a leaked token discloses nothing new to whoever already had it.
 */
export async function pollJoinStatus(data: { token: string }) {
  const joinId = await verifyStatusPollToken(data.token);
  if (!joinId) {
    // Expired or malformed — the client falls back to the form.
    return { error: "expired" as const };
  }

  // Generous, but not unlimited: this exists to stop a flood, not to authorise.
  //
  // Keyed on the join id rather than the IP, which is the opposite of every other
  // limit here — deliberately. Mobile carriers put thousands of phones behind one
  // address, so an IP key would make two members polling from the same network
  // share a bucket and cut each other off. The token already proves which request
  // this is and cannot be forged, so a per-join key is both safe and precise: the
  // worst anyone can do with their own token is throttle their own page.
  const rl = await checkRateLimit(`joinpoll:${joinId}`, {
    max: 240,
    windowMinutes: 15,
    blockMinutes: 5,
  });
  if (!rl.allowed) return { error: "throttled" as const };

  try {
    const joins = await db
      .select({
        status: onlineJoins.status,
        memberId: onlineJoins.memberId,
        // proofUploadedAt, not proofImage. This runs every few seconds for as
        // long as the member watches the page, and proofImage is ~80KB of
        // base64 — reading it to produce a boolean would move megabytes per
        // wait, for nothing. The timestamp is written in the same statement as
        // the image, so its presence means the same thing.
        proofUploadedAt: onlineJoins.proofUploadedAt,
      })
      .from(onlineJoins)
      .where(eq(onlineJoins.id, joinId))
      .limit(1);
    if (!joins.length) return { error: "expired" as const };
    const join = joins[0];

    let gymId: number | null = null;
    let expiry: string | null = null;
    if (join.status === "paid" && join.memberId) {
      const m = (
        await db
          .select({
            gymId: members.gymId,
            membershipExpiry: members.membershipExpiry,
          })
          .from(members)
          .where(eq(members.id, join.memberId))
          .limit(1)
      )[0];
      gymId = m?.gymId ?? null;
      expiry = m?.membershipExpiry ?? null;
    }

    return {
      success: true as const,
      status: join.status,
      gymId,
      expiry,
      hasProof: Boolean(join.proofUploadedAt),
    };
  } catch {
    // A failed poll is not worth surfacing — the next tick tries again.
    return { error: "failed" as const };
  }
}
