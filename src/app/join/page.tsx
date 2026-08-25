import JoinPlansClient from "./join-plans-client";
import { getPublicBranches } from "@/app/actions/payments";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Join Brothers Gym Online",
  description:
    "Join Brothers Gym online — pick your branch, choose a plan, pay securely via UPI, Cards, or Netbanking. RBI-authorized Razorpay gateway.",
};

export default async function JoinPage() {
  const branches = await getPublicBranches();

  return (
    <div style={{ backgroundColor: "#0a0a0f", minHeight: "100vh" }}>
      <JoinPlansClient initialBranches={branches} />
    </div>
  );
}