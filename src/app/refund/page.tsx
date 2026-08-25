import LegalLayout from "@/app/components/legal-layout";
import { XCircle, CheckCircle, AlertTriangle, IndianRupee, HelpCircle } from "lucide-react";

export const metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "Brothers Gym refund and cancellation policy — all payments are non-refundable.",
};

export default async function RefundPolicyPage() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      subtitle="Please read this policy carefully before making any payment."
    >
      {/* KEY POLICY — BIG RED BOX */}
      <div className="not-prose bg-red-500/10 border-2 border-red-500/50 rounded-2xl p-6 mb-10">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-red-500/20 border-2 border-red-500/50 rounded-xl flex items-center justify-center shrink-0">
            <XCircle size={28} className="text-red-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-black text-red-400 mb-2 uppercase">
              No Refund Policy
            </h2>
            <p className="text-white leading-relaxed mb-3">
              <strong>ALL PAYMENTS TO BROTHERS GYM ARE STRICTLY NON-REFUNDABLE.</strong>
            </p>
            <p className="text-zinc-300 text-sm leading-relaxed">
              This applies to all membership fees, personal training packages, and any
              other services — whether paid online via Razorpay or offline at the gym
              reception. Please make sure you are committed before making any payment.
            </p>
          </div>
        </div>
      </div>

      <Section icon={<IndianRupee size={20} />} title="1. Membership Fees">
        <ul>
          <li>
            Once paid, membership fees are <strong className="text-red-400">100%
            non-refundable</strong>.
          </li>
          <li>
            This includes all plan durations: 1 month, 3 months, 6 months, and 12
            months.
          </li>
          <li>
            This applies to both Cardio and Hardcore membership types.
          </li>
          <li>
            Refunds will NOT be provided for reasons including but not limited to:
            <ul className="mt-2">
              <li>Change of mind after payment</li>
              <li>Inability to visit the gym due to personal reasons</li>
              <li>Relocation to a different city</li>
              <li>Loss of interest in fitness</li>
              <li>Health issues arising after joining</li>
              <li>Job or lifestyle changes</li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section icon={<IndianRupee size={20} />} title="2. Personal Training (PT) Packages">
        <ul>
          <li>
            PT packages are non-refundable once purchased.
          </li>
          <li>
            Unused PT sessions do NOT carry forward beyond the package validity period.
          </li>
          <li>
            PT packages cannot be transferred to another member.
          </li>
          <li>
            If a trainer is unavailable, we will assign a replacement trainer of similar
            expertise. No refunds will be issued in this case.
          </li>
        </ul>
      </Section>

      <Section icon={<XCircle size={20} />} title="3. Cancellation">
        <ul>
          <li>
            You may cancel your membership at any time by informing the branch owner.
          </li>
          <li>
            <strong className="text-red-400">
              Cancellation does NOT entitle you to any refund
            </strong>{" "}
            of the fees paid.
          </li>
          <li>
            Your membership will remain active until its expiry date.
          </li>
          <li>
            After cancellation, your data will be retained per our{" "}
            <a href="/privacy" className="text-yellow-500 underline">
              Privacy Policy
            </a>
            .
          </li>
        </ul>
      </Section>

      <Section icon={<CheckCircle size={20} />} title="4. Exceptional Circumstances">
        <p>
          In extremely rare cases, at the sole discretion of the branch owner, refunds
          MAY be considered for:
        </p>
        <ul>
          <li>
            <strong className="text-white">Duplicate Payment:</strong> If you accidentally
            paid twice for the same membership, we will refund the duplicate amount
            after verification.
          </li>
          <li>
            <strong className="text-white">Payment Gateway Error:</strong> If your money
            was deducted but membership was not activated due to a technical error, we
            will investigate and refund within 7 working days.
          </li>
          <li>
            <strong className="text-white">Serious Medical Emergency:</strong> In case
            of a documented serious medical condition preventing gym use, the owner may
            offer credit toward future membership (not a cash refund).
          </li>
        </ul>
        <p className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm">
          <strong className="text-yellow-500">Note:</strong> Any exceptional refund is
          at the sole discretion of the branch owner and requires proper documentation.
          Decisions are final.
        </p>
      </Section>

      <Section icon={<AlertTriangle size={20} />} title="5. Refund Process (If Approved)">
        <p>
          In the rare case that a refund is approved (per Section 4 above), the process
          is as follows:
        </p>
        <ul>
          <li>
            <strong>Timeline:</strong> Refunds will be processed within 7-10 working
            days.
          </li>
          <li>
            <strong>Method:</strong> Refunds will be issued to the original payment
            method (UPI/Card/Bank Account).
          </li>
          <li>
            <strong>Deductions:</strong> Payment gateway fees (typically 2% + GST) will
            be deducted from the refund amount.
          </li>
          <li>
            <strong>Documentation:</strong> You must provide transaction ID and reason
            in writing (email or WhatsApp).
          </li>
        </ul>
      </Section>

      <Section icon={<HelpCircle size={20} />} title="6. Chargebacks & Disputes">
        <ul>
          <li>
            Filing a false chargeback with your bank/card company after receiving
            services is considered fraud and will result in:
            <ul className="mt-2">
              <li>Immediate termination of membership without refund</li>
              <li>Legal action under the Indian Contract Act</li>
              <li>Reporting to the payment gateway blacklist</li>
            </ul>
          </li>
          <li>
            If you have a legitimate concern about a charge, please contact the branch
            owner FIRST before disputing with your bank.
          </li>
        </ul>
      </Section>

      <Section icon={<CheckCircle size={20} />} title="7. Why No Refund Policy?">
        <p>
          Brothers Gym operates on a fair and transparent basis:
        </p>
        <ul>
          <li>
            Our membership fees are already affordable and reflect actual operating
            costs.
          </li>
          <li>
            Equipment maintenance, staff salaries, rent, and utilities are ongoing
            expenses that cannot be reversed.
          </li>
          <li>
            A no-refund policy allows us to keep prices low for all members.
          </li>
          <li>
            We encourage members to visit the gym before joining to ensure it&apos;s
            the right fit for them.
          </li>
        </ul>
        <p className="mt-4">
          We recommend visiting the gym for a walkthrough before committing to a
          membership. Please contact the branch owner to schedule a visit.
        </p>
      </Section>

      <Section title="8. Contact for Refund Queries">
        <p>
          For any refund-related queries, contact the respective branch owner using
          the contact information below.
        </p>
        <p className="mt-3 text-sm text-zinc-400">
          Please include your payment transaction ID, date, and reason for your query.
        </p>
      </Section>
    </LegalLayout>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 not-prose">
      <h2 className="text-2xl font-black text-white mb-4 flex items-center gap-3">
        {icon && <span className="text-yellow-500">{icon}</span>}
        {title}
      </h2>
      <div className="text-zinc-300 text-sm md:text-base leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:text-zinc-400 [&_ul_li]:leading-relaxed [&_ul_ul]:mt-2 [&_ul_ul]:pl-4">
        {children}
      </div>
    </div>
  );
}