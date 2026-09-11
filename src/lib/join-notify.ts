/**
 * Delivering the Gym ID to the member, on every path that creates a membership.
 *
 * There are three of them — the browser callback after a gateway payment
 * (verifyOnlinePayment), the Razorpay webhook, and the owner confirming a
 * fallback lead by hand (confirmManualJoinPayment) — and the member should get
 * the same thing from all three. Before this module only the manual path sent
 * anything at all, so a member who paid by card got a Gym ID that existed
 * nowhere except the screen they were looking at.
 *
 * TWO CHANNELS, BY DESIGN
 *
 *   Email     automatic, and the one that carries the Gym ID in writing. Sent
 *             ONLY when the member actually gave us an address (it is an optional
 *             field on the join form) — no address, no send, no wasted quota.
 *   WhatsApp  a pre-filled wa.me link handed to the OWNER, who taps send. Not an
 *             automated send: both owners' numbers are already registered on
 *             normal WhatsApp, and the Cloud API would need a fresh SIM per
 *             branch plus template approval. Tapping a link costs nothing, works
 *             today, and arrives from the number the member already knows.
 *
 * EMAIL BUDGET
 * Resend's free tier is 3,000/month. Nothing here loops or batches: at most one
 * email per membership created. The gateway path actually sends FEWER than the
 * old manual flow did, because a successful payment replaces the two-step
 * "received → confirmed" sequence with a single confirmation.
 *
 * BEST-EFFORT, ALWAYS
 * The membership is already committed by the time anything here runs. A dead
 * mail provider must never turn a paid membership into an error, so every send
 * is wrapped and failures are logged, not thrown. Callers do not await a result
 * they can act on — they just pass the WhatsApp link to the owner's screen.
 */

import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { fromHeader, joinConfirmedEmail } from "@/lib/email-templates";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { formatDayIST } from "@/lib/manual-join";

export type JoinNotifyInput = {
  /** Member's email, exactly as they typed it — null/empty means do not send. */
  email: string | null;
  branchId: number;
  memberName: string;
  gymId: number;
  planName?: string;
  amount: number;
  /** ISO date string (yyyy-mm-dd) the membership runs to. */
  expiry: string;
  contactNumber: string;
  isRenewal: boolean;
};

export type JoinNotifyResult = {
  /** wa.me link for the owner to tap. Empty when the phone number is unusable. */
  whatsappLink: string;
  /** True only when an email was actually handed to Resend. */
  emailSent: boolean;
  /** Why no email went out, for the owner's screen and the logs. */
  emailSkipped: "no-address" | "not-configured" | "failed" | null;
  branchName: string;
};

/**
 * Is the Resend key a real key rather than the masked placeholder that ships in
 * .env.example? Sending with a placeholder throws on every request and fills the
 * logs, so the send is skipped instead.
 */
function resendKey(): string | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || /x{4,}/i.test(apiKey)) return null;
  return apiKey;
}

/** The message the owner sends. Plain text — it goes through a wa.me URL. */
export function gymIdWhatsAppMessage(opts: {
  memberName: string;
  gymId: number;
  planName?: string;
  expiry: string;
  isRenewal: boolean;
}): string {
  const validUntil = formatDayIST(opts.expiry);
  const plan = opts.planName ? `Plan: ${opts.planName}\n` : "";

  return opts.isRenewal
    ? `Hi ${opts.memberName}! 💪 Your Brothers Gym membership is renewed.\n\n` +
        `Gym ID: ${opts.gymId}\n${plan}Valid until: ${validUntil}\n\n` +
        `Thanks for staying with us!\n- Brothers Gym`
    : `Hi ${opts.memberName}! 💪 Welcome to Brothers Gym — your membership is confirmed.\n\n` +
        `Gym ID: ${opts.gymId}\n${plan}Valid until: ${validUntil}\n\n` +
        `Show your Gym ID at the counter. See you at the gym!\n- Brothers Gym`;
}

/**
 * Send the member their Gym ID and build the owner's WhatsApp link.
 *
 * Safe to call from a webhook, a server action or a route handler. Never throws.
 * Call it only after fulfilment reported ok — because fulfilment is a
 * compare-and-swap, only the race winner gets there, so a member whose payment
 * arrives by browser callback AND webhook still gets exactly one email.
 */
export async function notifyJoinConfirmed(
  input: JoinNotifyInput
): Promise<JoinNotifyResult> {
  let branchName = "";
  try {
    const rows = await db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1);
    branchName = rows[0]?.name || "";
  } catch (e) {
    console.error("[JoinNotify] branch lookup failed:", e);
  }

  let emailSent = false;
  let emailSkipped: JoinNotifyResult["emailSkipped"] = null;

  const to = (input.email || "").trim();
  if (!to) {
    // Email is optional on the join form. Skipping silently is the whole point:
    // the Gym ID still reaches them on screen and by WhatsApp from the owner.
    emailSkipped = "no-address";
  } else {
    const apiKey = resendKey();
    if (!apiKey) {
      emailSkipped = "not-configured";
    } else {
      try {
        const { subject, html, text } = joinConfirmedEmail({
          memberName: input.memberName,
          gymId: input.gymId,
          planName: input.planName,
          amount: input.amount,
          expiry: input.expiry,
          branchName,
          isRenewal: input.isRenewal,
        });
        await new Resend(apiKey).emails.send({
          from: fromHeader(),
          to,
          subject,
          html,
          text,
        });
        emailSent = true;
      } catch (e) {
        // Includes the shared-sender 403 that applies until brothersgym.in is
        // verified with Resend. Not fatal — the membership is already active.
        console.error("[JoinNotify] confirmation email failed:", e);
        emailSkipped = "failed";
      }
    }
  }

  const whatsappLink = buildWhatsAppLink(
    input.contactNumber,
    gymIdWhatsAppMessage({
      memberName: input.memberName,
      gymId: input.gymId,
      planName: input.planName,
      expiry: input.expiry,
      isRenewal: input.isRenewal,
    })
  );

  return { whatsappLink, emailSent, emailSkipped, branchName };
}
