import LegalLayout from "@/app/components/legal-layout";
import { LegalSection, LegalCallout } from "@/app/components/legal-ui";
import Link from "next/link";
import { XCircle, CheckCircle, IndianRupee, HelpCircle, Ban } from "lucide-react";

export const metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "Brothers Gym refund and cancellation policy — all payments are non-refundable.",
  alternates: { canonical: "/refund" },
};

// Drives the "On this page" rail. Order and ids must match the LegalSection
// ids below.
const SECTIONS = [
  { id: "membership-fees", label: "1. Membership Fees" },
  { id: "pt-packages", label: "2. Personal Training" },
  { id: "cancellation", label: "3. Cancellation" },
  { id: "exceptions", label: "4. Exceptional Circumstances" },
  { id: "refund-process", label: "5. Refund Process" },
  { id: "chargebacks", label: "6. Chargebacks & Disputes" },
  { id: "why-no-refund", label: "7. Why No Refunds?" },
  { id: "contact", label: "8. Contact" },
];

export default async function RefundPolicyPage() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      subtitle="Please read this policy carefully before making any payment."
      sections={SECTIONS}
      currentPath="/refund"
    >
      {/* The single most important sentence on the page, and the one a member is
          most likely to dispute later — so it leads, in the danger variant. */}
      <LegalCallout
        variant="danger"
        icon={<XCircle size={18} className="text-red-400" />}
        title="No Refund Policy"
      >
        <p>
          <strong className="text-red-300">
            All payments to Brothers Gym are strictly non-refundable.
          </strong>
        </p>
        <p>
          This applies to all membership fees, personal training packages, and any other
          services — whether paid online by UPI or offline at the gym reception. Please
          make sure you are committed before making any payment.
        </p>
      </LegalCallout>

      <LegalSection
        id="membership-fees"
        icon={<IndianRupee size={18} />}
        title="1. Membership Fees"
      >
        <ul>
          <li>
            Once paid, membership fees are{" "}
            <strong className="text-red-400">100% non-refundable</strong>.
          </li>
          <li>
            This includes all plan durations: 1 month, 3 months, 6 months, and 12 months.
          </li>
          <li>This applies to both Cardio and Hardcore membership types.</li>
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
      </LegalSection>

      <LegalSection
        id="pt-packages"
        icon={<IndianRupee size={18} />}
        title="2. Personal Training (PT) Packages"
      >
        <ul>
          <li>PT packages are non-refundable once purchased.</li>
          <li>Unused PT sessions do NOT carry forward beyond the package validity period.</li>
          <li>PT packages cannot be transferred to another member.</li>
          <li>
            If a trainer is unavailable, we will assign a replacement trainer of similar
            expertise. No refunds will be issued in this case.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cancellation" icon={<Ban size={18} />} title="3. Cancellation">
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
          <li>Your membership will remain active until its expiry date.</li>
          <li>
            After cancellation, your data will be retained per our{" "}
            <Link href="/privacy" className="text-yellow-500 underline">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="exceptions"
        icon={<CheckCircle size={18} />}
        title="4. Exceptional Circumstances"
      >
        <p>
          In extremely rare cases, at the sole discretion of the branch owner, refunds MAY
          be considered for:
        </p>
        <ul>
          <li>
            <strong className="text-white">Duplicate Payment:</strong> If you accidentally
            paid twice for the same membership, we will refund the duplicate amount after
            verification.
          </li>
          <li>
            <strong className="text-white">Payment Not Confirmed:</strong> If your UPI
            payment left your account but your membership was not activated, contact us
            with your UPI reference/UTR number — we will verify it against the gym&apos;s
            records and either activate your membership or refund you within 7 working
            days.
          </li>
          <li>
            <strong className="text-white">Serious Medical Emergency:</strong> In case of a
            documented serious medical condition preventing gym use, the owner may offer
            credit toward future membership (not a cash refund).
          </li>
        </ul>
        <LegalCallout variant="note" title="Discretionary">
          <p>
            Any exceptional refund is at the sole discretion of the branch owner and
            requires proper documentation. Decisions are final.
          </p>
        </LegalCallout>
      </LegalSection>

      <LegalSection
        id="refund-process"
        icon={<IndianRupee size={18} />}
        title="5. Refund Process (If Approved)"
      >
        <p>
          In the rare case that a refund is approved (per Section 4 above), the process is
          as follows:
        </p>
        <ul>
          <li>
            <strong className="text-white">Timeline:</strong> Refunds will be processed
            within 7-10 working days.
          </li>
          <li>
            <strong className="text-white">Method:</strong> Refunds are sent back to the
            UPI ID or bank account you paid from.
          </li>
          <li>
            <strong className="text-white">No Gateway Deduction:</strong> UPI transfers
            carry no payment-gateway fee, so an approved refund is returned in full.
          </li>
          <li>
            <strong className="text-white">Documentation:</strong> You must provide
            transaction ID and reason in writing (email or WhatsApp).
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="chargebacks"
        icon={<XCircle size={18} />}
        title="6. Chargebacks & Disputes"
      >
        <ul>
          <li>
            Filing a false payment dispute or chargeback with your bank after receiving
            services is considered fraud and will result in:
            <ul className="mt-2">
              <li>Immediate termination of membership without refund</li>
              <li>Legal action under the Indian Contract Act</li>
              <li>Reporting the dispute to your bank and UPI provider</li>
            </ul>
          </li>
          <li>
            If you have a legitimate concern about a charge, please contact the branch
            owner FIRST before disputing with your bank.
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="why-no-refund"
        icon={<HelpCircle size={18} />}
        title="7. Why No Refund Policy?"
      >
        <p>Brothers Gym operates on a fair and transparent basis:</p>
        <ul>
          <li>
            Our membership fees are already affordable and reflect actual operating costs.
          </li>
          <li>
            Equipment maintenance, staff salaries, rent, and utilities are ongoing expenses
            that cannot be reversed.
          </li>
          <li>A no-refund policy allows us to keep prices low for all members.</li>
          <li>
            We encourage members to visit the gym before joining to ensure it&apos;s the
            right fit for them.
          </li>
        </ul>
        <p>
          We recommend visiting the gym for a walkthrough before committing to a
          membership. Please contact the branch owner to schedule a visit.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="8. Contact for Refund Queries">
        <p>
          For any refund-related queries, contact the respective branch owner using the
          contact information below.
        </p>
        <p className="text-sm text-zinc-500">
          Please include your payment transaction ID, date, and reason for your query.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
