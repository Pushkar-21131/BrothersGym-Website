import JoinPlansClient from "./join-plans-client";
import { getPublicBranches } from "@/app/actions/payments";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join Brothers Gym Online",
  description:
    "Join Brothers Gym online — pick your branch, choose a plan, and pay securely by UPI, card or netbanking.",
};

export default async function JoinPage() {
  const branches = await getPublicBranches();

  /**
   * PAYMENT_MODE — two values, and the default is the gateway.
   *
   *   razorpay (default)  Razorpay checkout. If it can't run for one member —
   *                       script blocked, order failed, modal closed — that one
   *                       member lands on the contact screen; everyone else
   *                       still pays online.
   *   contact             The site-wide kill switch. No gateway is attempted at
   *                       all: no checkout.js, no Razorpay hosts in the CSP, no
   *                       preconnect. Every join becomes a lead the owner calls.
   *
   * `contact` is the mode to deploy on while KYC is pending, and the mode to
   * fall back to if a merchant account is suspended. It is deliberately NOT the
   * default: an unset or mistyped variable should leave the gateway on, because
   * the failure mode of "gateway on but broken" is one member on the contact
   * screen, whereas "gateway silently off" is every member paying at the counter
   * without anyone noticing for a week.
   *
   * There is no third mode. The old `manual` value took UPI payments on-site
   * against a QR code and asked the member to upload a screenshot — deleted,
   * because it left the owner arguing with members over payments he had no way
   * to verify. A stale PAYMENT_MODE=manual in an env file now reads as
   * "not contact", i.e. the gateway, which is the safe way for it to be wrong.
   */
  const paymentMode =
    process.env.PAYMENT_MODE === "contact" ? "contact" : "razorpay";

  return (
    <div style={{ backgroundColor: "#0a0a0f", minHeight: "100vh" }}>
      <JoinPlansClient initialBranches={branches} paymentMode={paymentMode} />
    </div>
  );
}
