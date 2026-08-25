/**
 * Razorpay webhook — the safety net under online joins.
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
 * SETUP (Razorpay Dashboard → Settings → Webhooks)
 *   URL     https://<your-domain>/api/webhooks/razorpay
 *   Events  payment.captured
 *   Secret  any long random string — put the SAME value in RAZORPAY_WEBHOOK_SECRET
 *
 * The webhook secret is NOT the API key secret. It is a separate value you
 * choose, and it is the only thing standing between this endpoint and anyone on
 * the internet handing us a fake "payment captured" message.
 */

import crypto from "crypto";
import { db } from "@/db";
import { onlineJoins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fulfilPaidJoin } from "@/lib/fulfil-join";

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

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // Refuse rather than skip verification. An unconfigured secret must never
  // degrade into trusting the caller.
  if (!secret) {
    console.error("[Webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting");
    return new Response("Webhook not configured", { status: 503 });
  }

  // MUST be the raw text. Parsing to JSON and re-stringifying changes byte order
  // and whitespace, and the HMAC would never match.
  const rawBody = await req.text();
  const received = req.headers.get("x-razorpay-signature") || "";

  if (!signatureMatches(rawBody, received, secret)) {
    console.error("[Webhook] signature mismatch — rejected");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Retrying will not help, so ACK it.
    console.error("[Webhook] signed body was not valid JSON");
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  // Only captured payments create memberships. Everything else — authorized,
  // failed, refunds, settlements — is acknowledged and ignored, so Razorpay
  // does not retry events we have no interest in.
  if (event?.event !== "payment.captured") {
    return Response.json({ ok: true, ignored: event?.event ?? "unknown" });
  }

  const payment = event?.payload?.payment?.entity;
  const orderId: string | undefined = payment?.order_id;
  const paymentId: string | undefined = payment?.id;
  const amountPaise = Number(payment?.amount);

  if (!orderId || !paymentId || !Number.isFinite(amountPaise)) {
    console.error("[Webhook] payment.captured missing order_id/id/amount");
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
    console.error(`[Webhook] no join row for order ${orderId}`);
    return Response.json({ ok: true, ignored: "no-matching-join" });
  }

  const join = joins[0];

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
      `[Webhook] join ${join.id} fulfilled — member ${result.memberId}, gym ID ${result.gymId}`
    );
    return Response.json({ ok: true, memberId: result.memberId });
  }

  // The browser got there first, mid-flight. Correct outcome, nothing to retry.
  if (result.code === "claimed") {
    return Response.json({ ok: true, alreadyProcessed: true });
  }

  // An amount mismatch will never fix itself on retry and needs a human.
  if (result.code === "mismatch") {
    console.error(`[Webhook] amount mismatch on join ${join.id} — needs an operator`);
    return Response.json({ ok: true, needsOperator: true });
  }

  // Transient (database down mid-transaction). 500 makes Razorpay retry, which
  // is exactly what we want — the join is still `pending` and safe to redo.
  return new Response("Fulfilment failed, retry", { status: 500 });
}
