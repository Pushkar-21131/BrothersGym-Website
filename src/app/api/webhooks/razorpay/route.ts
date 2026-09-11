/**
 * Retired endpoint — the Razorpay webhook is now per-branch.
 *
 * The two branches have different owners and therefore two separate Razorpay
 * accounts, each with its own webhook secret. A single shared endpoint cannot
 * know which secret a delivery should be verified against, so every account now
 * posts to a URL that names its branch:
 *
 *   https://<domain>/api/webhooks/razorpay/NR
 *   https://<domain>/api/webhooks/razorpay/SP
 *
 * This file is deliberately kept rather than deleted. If either dashboard is
 * still pointed at the old path, a 410 with a message in the Razorpay delivery
 * log is far easier to diagnose than a bare 404 — and much safer than the
 * alternative of guessing which account sent it.
 *
 * It verifies nothing and fulfils nothing. Do not add logic here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGE =
  "This webhook URL is retired. Each Razorpay account must post to its own " +
  "branch-scoped URL: /api/webhooks/razorpay/NR or /api/webhooks/razorpay/SP. " +
  "Update the endpoint in Razorpay Dashboard → Settings → Webhooks.";

export async function POST() {
  console.error(`[Webhook] delivery to retired shared URL — ${MESSAGE}`);
  return new Response(MESSAGE, { status: 410 });
}

/** Answered so the retirement is visible to anyone opening the URL in a browser. */
export async function GET() {
  return new Response(MESSAGE, { status: 410 });
}
