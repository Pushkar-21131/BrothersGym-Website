import JoinPlansClient from "./join-plans-client";
import { getPublicBranches } from "@/app/actions/payments";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join Brothers Gym Online",
  description:
    "Join Brothers Gym online — pick your branch, choose a plan, and pay by UPI. Your membership is confirmed by the gym once payment is received.",
};

export default async function JoinPage() {
  const branches = await getPublicBranches();

  // manual (default) → pay-by-UPI + owner confirmation. razorpay → the parked
  // gateway checkout. The mode decides which final step the client renders and
  // whether the Razorpay script/CSP are loaded at all.
  const paymentMode =
    process.env.PAYMENT_MODE === "razorpay" ? "razorpay" : "manual";

  return (
    <div style={{ backgroundColor: "#0a0a0f", minHeight: "100vh" }}>
      <JoinPlansClient initialBranches={branches} paymentMode={paymentMode} />
    </div>
  );
}
