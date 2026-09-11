/**
 * Razorpay webhook, scoped to one branch's merchant account.
 *
 * WHY THIS EXISTS
 * Membership creation used to depend entirely on the Razorpay checkout `handler`
 * callback running in the member's browser. If they closed the tab, lost signal,
 * or their battery died in the second or two after paying, Razorpay captured the
 * money and no membership was ever created. The join row sat `pending` forever
 * and nobody was told. The member had paid and had nothing.
 *
 * Razorpay calls this route server-to-server, so it does not care what the
 * browser did. Whichever of the two arrives first creates the membership; the
 * other loses the compare-and-swap inside `fulfilPaidJoin` and writes nothing.
 *
 * WHY THE URL IS PER-BRANCH
 * The two branches have different owners and therefore two separate Razorpay
 * accounts, each signing with its own webhook secret. A single shared endpoint
 * could not know which secret to verify against without trying both — and
 * "whichever secret happens to match" is a weaker statement than "this delivery
 * came from the account we expected on this URL". One path per account keeps the
 * intended signer explicit.
 *
 * SETUP — do this in EACH owner's Razorpay Dashboard → Settings → Webhooks
 *   NR account   https://<domain>/api/webhooks/razorpay/NR
 *                secret → RAZORPAY_WEBHOOK_SECRET_NR
 *   SP account   https://<domain>/api/webhooks/razorpay/SP
 *                secret → RAZORPAY_WEBHOOK_SECRET_SP
 *   Events       payment.captured   (NOT payment.authorized — see below)
 *
 * The webhook secret is NOT the API key secret. It is a separate value chosen in
 * each dashboard, and it is the only thing standing between this endpoint and
 * anyone on the internet handing us a fake "payment captured" message.
 */

import crypto from "crypto";
import { db } from "@/db";
import { onlineJoins, branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fulfilPaidJoin } from "@/lib/fulfil-join";
import { notifyJoinConfirmed } from "@/lib/join-notify";
import {
  razorpayWebhookSecretFor,
  normaliseBranchCode,
} from "@/lib/razorpay-account";

// Node runtime: the Edge runtime has no `crypto.timingSafeEqual`.
export const runtime = "nodejs";
// Never cached — every delivery must actually execute.
export const dynamic = "force-dynamic";

function signatureMatches(rawBody: string, received: string, secret: string) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received || "", "utf8");
  // Length is checked first because timingSafeEqual throws on a mismatch. The
  // length of a hex digest is not a secret, so this leaks nothing.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ branch: string }> }
) {
  const { branch } = await ctx.params;
  const urlBranch = normaliseBranchCode(branch || "");

  const secret = razorpayWebhookSecretFor(urlBranch);

  // Refuse rather than skip verification. An unconfigured secret must never
  // degrade into trusting the caller.
  if (!secret) {
    console.error(
      `[Webhook ${urlBranch}] no webhook secret configured — rejecting. ` +
        `Set RAZORPAY_WEBHOOK_SECRET_${urlBranch}.`
    );
    return new Response("Webhook not configured", { status: 503 });
  }

  // MUST be the raw text. Parsing to JSON and re-stringifying changes byte order
  // and whitespace, and the HMAC would never match.
  const rawBody = await req.text();
  const received = req.headers.get("x-razorpay-signature") || "";

  if (!signatureMatches(rawBody, received, secret)) {
    console.error(`[Webhook ${urlBranch}] signature mismatch — rejected`);
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Retrying will not help, so ACK it.
    console.error(`[Webhook ${urlBranch}] signed body was not valid JSON`);
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  // Only captured payments create memberships. `payment.authorized` fires before
  // the money is actually captured, so acting on it can hand out a membership
  // against funds that never land. Everything else — failed, refunds,
  // settlements — is acknowledged and ignored so Razorpay stops retrying events
  // we have no interest in.
  if (event?.event !== "payment.captured") {
    return Response.json({ ok: true, ignored: event?.event ?? "unknown" });
  }

  const payment = event?.payload?.payment?.entity;
  const orderId: string | undefined = payment?.order_id;
  const paymentId: string | undefined = payment?.id;
  const amountPaise = Number(payment?.amount);

  if (!orderId || !paymentId || !Number.isFinite(amountPaise)) {
    console.error(`[Webhook ${urlBranch}] payment.captured missing order_id/id/amount`);
    return Response.json({ ok: true, ignored: "malformed" });
  }

  // The order ID is the join's identity here. Unlike the browser path there is
  // no caller-supplied joinId to bind, so nothing needs re-checking against it.
  const joins = await db
    .select()
    .from(onlineJoins)
    .where(eq(onlineJoins.razorpayOrderId, orderId))
    .limit(1);

  if (!joins.length) {
    // A payment on this account that did not originate from the join form, or
    // one whose join row was deleted. Not our problem to retry.
    console.error(`[Webhook ${urlBranch}] no join row for order ${orderId}`);
    return Response.json({ ok: true, ignored: "no-matching-join" });
  }

  const join = joins[0];

  // ===== THE CROSS-BRANCH GUARD =====
  // A valid signature proves this delivery came from the account that owns
  // `urlBranch`. It does NOT prove the join belongs to that branch, and with two
  // owners those are different claims.
  //
  // Each owner legitimately knows their own webhook secret. Without this check
  // the NR owner could sign a well-formed `payment.captured` naming an SP order
  // and mint a free SP membership — money never paid to the SP owner, and a
  // signature that verifies perfectly. When one person owned both accounts this
  // was meaningless; now it is a real privilege boundary between two people.
  //
  // It also catches the far likelier honest mistake: both dashboards configured
  // against the same URL, quietly fulfilling one branch's joins with the other's
  // deliveries.
  const joinBranch = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, join.branchId))
    .limit(1);
  const joinBranchCode = normaliseBranchCode(joinBranch[0]?.code || "");

  if (!joinBranchCode || joinBranchCode !== urlBranch) {
    console.error(
      `[Webhook ${urlBranch}] REJECTED cross-branch delivery: order ${orderId} ` +
        `belongs to branch ${joinBranchCode || "unknown"}. Check that each Razorpay ` +
        `account's webhook URL ends in its own branch code.`
    );
    // 401, not 500: this delivery is not something a retry can fix, and it
    // should be loud in the Razorpay dashboard rather than silently ACKed.
    return new Response("Branch mismatch", { status: 401 });
  }

  // Fast path: the browser callback already finished. Nothing to do.
  if (join.status === "paid") {
    return Response.json({ ok: true, alreadyProcessed: true });
  }

  // parentName and emergencyContact are not in the webhook payload and are not
  // stored on the join row, so a membership created by this path records them
  // as null. `fulfilPaidJoin` logs that for an operator to fill in from the
  // admin panel. Granting the membership late and incomplete beats leaving
  // someone who paid with nothing at all.
  const result = await fulfilPaidJoin({
    join,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    paidAmountPaise: amountPaise,
    consentIp: null,
    source: "webhook",
  });

  if (result.ok) {
    console.log(
      `[Webhook ${urlBranch}] join ${join.id} fulfilled — member ${result.memberId}, gym ID ${result.gymId}`
    );

    // ===== GYM ID DELIVERY =====
    // This is the path that matters most for delivery: the browser never came
    // back (closed tab, dead network, UPI app that swallowed the redirect), so
    // the member has NOT seen their Gym ID on screen. The email is the only
    // channel that reaches them unprompted — and only if they gave an address,
    // in which case the owner's admin panel still carries the WhatsApp link.
    //
    // Awaited rather than fired and forgotten: a serverless function can be
    // frozen the moment it returns a response, which would cut the send off
    // mid-flight. notifyJoinConfirmed never throws, so this cannot turn a
    // fulfilled payment into a 500 and a pointless Razorpay retry.
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
    if (!notify.emailSent) {
      // Worth a line in the logs: on this path nobody has seen the Gym ID yet,
      // so the owner has to send it. "no-address" is normal, the rest are not.
      console.warn(
        `[Webhook ${urlBranch}] join ${join.id}: no confirmation email sent (${notify.emailSkipped}) — ` +
          `gym ID ${result.gymId} must go out from the admin panel`
      );
    }

    return Response.json({ ok: true, memberId: result.memberId });
  }

  // The browser got there first, mid-flight. Correct outcome, nothing to retry.
  if (result.code === "claimed") {
    return Response.json({ ok: true, alreadyProcessed: true });
  }

  // An amount mismatch will never fix itself on retry and needs a human.
  if (result.code === "mismatch") {
    console.error(
      `[Webhook ${urlBranch}] amount mismatch on join ${join.id} — needs an operator`
    );
    return Response.json({ ok: true, needsOperator: true });
  }

  // Transient (database down mid-transaction). 500 makes Razorpay retry, which
  // is exactly what we want — the join is still `pending` and safe to redo.
  return new Response("Fulfilment failed, retry", { status: 500 });
}
