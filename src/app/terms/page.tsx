import LegalLayout from "@/app/components/legal-layout";
import { LegalSection, LegalCallout } from "@/app/components/legal-ui";
import Link from "next/link";
import { FileText, IndianRupee, Users, Shield, XCircle } from "lucide-react";

export const metadata = {
  title: "Terms & Conditions",
  description: "Brothers Gym terms and conditions for membership and website usage.",
  alternates: { canonical: "/terms" },
};

// Drives the "On this page" rail. Order and ids must match the LegalSection
// ids below.
const SECTIONS = [
  { id: "membership", label: "1. Membership" },
  { id: "payments", label: "2. Payments" },
  { id: "conduct", label: "3. Gym Rules & Conduct" },
  { id: "personal-training", label: "4. Personal Training" },
  { id: "health-safety", label: "5. Health & Safety" },
  { id: "termination", label: "6. Termination" },
  { id: "website-usage", label: "7. Website Usage" },
  { id: "liability", label: "8. Limitation of Liability" },
  { id: "disputes", label: "9. Dispute Resolution" },
  { id: "changes", label: "10. Changes to Terms" },
  { id: "contact", label: "11. Contact" },
];

export default async function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      subtitle="Please read these terms carefully before using our services or becoming a member."
      sections={SECTIONS}
      currentPath="/terms"
    >
      <LegalCallout variant="danger" title="By joining, you accept these terms">
        <p>
          By joining Brothers Gym or using our website, you agree to be bound by these
          Terms &amp; Conditions. If you do not agree, please do not use our services.
          Membership fees are <strong className="text-red-300">non-refundable</strong> —
          see our{" "}
          <Link href="/refund" className="text-yellow-500 underline">
            Refund Policy
          </Link>{" "}
          for details.
        </p>
      </LegalCallout>

      <LegalSection id="membership" icon={<Users size={18} />} title="1. Membership">
        <ul>
          <li>
            Membership is valid only at the specific branch where you enrolled (Nangal
            Raya OR Sagar Pur). Cross-branch access is not permitted.
          </li>
          <li>
            Membership fees are <strong className="text-red-400">non-refundable</strong>{" "}
            once paid, whether online or offline.
          </li>
          <li>Memberships cannot be transferred to another person.</li>
          <li>Memberships cannot be paused, frozen, or extended for personal reasons.</li>
          <li>Expired memberships must be renewed to continue gym access.</li>
          <li>
            Brothers Gym reserves the right to terminate any membership for misconduct,
            harassment, damage to property, or violation of gym rules — without refund.
          </li>
          <li>
            Members below 18 years of age require parent/guardian consent (Father&apos;s
            Name is collected for this purpose).
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="payments" icon={<IndianRupee size={18} />} title="2. Payments">
        <ul>
          <li>
            Online joins are paid by <strong className="text-white">UPI</strong> — scan
            the QR code or tap &ldquo;Open in UPI app&rdquo; on the join page and pay
            directly to the gym&apos;s UPI account from any UPI app (Google Pay, PhonePe,
            Paytm, or your bank).
          </li>
          <li>
            Your membership is{" "}
            <strong className="text-white">
              activated once the gym confirms your payment
            </strong>
            . This is a manual step and is usually quick during working hours — you can
            track it on the membership status page or contact the owner if you don&apos;t
            hear back.
          </li>
          <li>Offline payments (cash) are accepted at the gym reception with a receipt.</li>
          <li>
            All online transactions are{" "}
            <strong className="text-red-400">final and non-refundable</strong>.
          </li>
          <li>Membership starts from the date of payment confirmation.</li>
          <li>
            Prices are subject to change with 30 days prior notice. Existing paid
            memberships are honored at their original price until expiry.
          </li>
          <li>
            Your Gym ID and payment confirmation are sent via WhatsApp and/or email once
            the gym confirms your payment.
          </li>
          <li>
            If a payment is not received or cannot be confirmed, no membership will be
            activated. Try again or contact the owner.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="conduct" icon={<FileText size={18} />} title="3. Gym Rules & Conduct">
        <ul>
          <li>Proper gym attire, shoes, and personal hygiene are mandatory.</li>
          <li>Equipment must be used responsibly and returned to its place after use.</li>
          <li>Wipe down equipment with a towel after use.</li>
          <li>
            Brothers Gym is <strong className="text-white">NOT responsible</strong> for
            personal belongings. Please use lockers if provided, or keep valuables with
            you.
          </li>
          <li>
            Any damage to equipment caused by misuse will be charged to the responsible
            member at replacement cost.
          </li>
          <li>
            Photography or videography inside the gym requires prior permission from the
            owner.
          </li>
          <li>
            Verbal or physical harassment of other members or staff will result in
            immediate termination without refund.
          </li>
          <li>
            Use of steroids, illegal supplements, or any banned substances on premises is
            strictly prohibited and will result in termination.
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="personal-training"
        icon={<Users size={18} />}
        title="4. Personal Training (PT)"
      >
        <ul>
          <li>PT sessions must be booked in advance directly with the trainer or owner.</li>
          <li>
            PT fees are <strong className="text-white">separate</strong> from regular
            membership fees.
          </li>
          <li>
            PT sessions are booked for specific time slots. Late arrival may result in
            reduced session time.
          </li>
          <li>
            Cancellations must be made at least 24 hours in advance. Late cancellations
            may forfeit the session.
          </li>
          <li>PT packages, once purchased, are non-refundable and non-transferable.</li>
        </ul>
      </LegalSection>

      <LegalSection id="health-safety" icon={<Shield size={18} />} title="5. Health & Safety">
        <ul>
          <li>
            Members are advised to consult a physician before starting any fitness
            program, especially those with pre-existing medical conditions.
          </li>
          <li>
            Members participate in all activities{" "}
            <strong className="text-white">at their own risk</strong>.
          </li>
          <li>
            Brothers Gym is <strong className="text-white">not liable</strong> for any
            injuries, health issues, or medical conditions sustained during workouts or
            resulting from gym activities.
          </li>
          <li>
            In case of medical emergency, staff will contact your registered emergency
            contact and/or arrange transport to the nearest hospital.
          </li>
          <li>
            Members with heart conditions, high BP, diabetes, or other serious conditions
            MUST inform the trainer and owner before starting.
          </li>
          <li>
            Pregnant members must consult their doctor and inform the trainer before
            using the gym.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="termination" icon={<XCircle size={18} />} title="6. Termination">
        <p>
          Brothers Gym reserves the right to terminate any membership without refund for
          the following reasons:
        </p>
        <ul>
          <li>Violation of gym rules or conduct policies</li>
          <li>Harassment of members or staff</li>
          <li>Damage to gym property</li>
          <li>Use of banned substances</li>
          <li>Fraudulent activity or false information</li>
          <li>Non-payment of dues</li>
        </ul>
      </LegalSection>

      <LegalSection id="website-usage" title="7. Website Usage">
        <ul>
          <li>Content on this website is for informational purposes only.</li>
          <li>
            All content (logos, images, text) is the property of Brothers Gym and
            protected under Indian copyright laws.
          </li>
          <li>
            Unauthorized use, reproduction, or scraping of website content is prohibited.
          </li>
          <li>You may not attempt to hack, disrupt, or reverse-engineer the website.</li>
          <li>
            Attempting unauthorized access to admin areas is a criminal offense under IT
            Act 2000.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="liability" title="8. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, Brothers Gym, its owners, staff, and
          affiliates shall not be liable for:
        </p>
        <ul>
          <li>Any indirect, incidental, or consequential damages</li>
          <li>Loss of personal belongings</li>
          <li>Injuries sustained during workouts</li>
          <li>Medical conditions triggered by exercise</li>
          <li>Service interruptions due to circumstances beyond our control</li>
        </ul>
      </LegalSection>

      <LegalSection id="disputes" title="9. Dispute Resolution & Jurisdiction">
        <p>Any disputes arising from these Terms shall be:</p>
        <ul>
          <li>
            First attempted to be resolved through direct discussion with the branch
            owner.
          </li>
          <li>
            If unresolved, disputes shall be subject to the exclusive jurisdiction of
            courts in New Delhi, India.
          </li>
          <li>
            Governed by the laws of India, particularly the Indian Contract Act, IT Act
            2000, DPDP Act 2023, and Consumer Protection Act 2019.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes to Terms">
        <p>
          Brothers Gym reserves the right to modify these terms at any time. Active
          members will be notified of material changes via WhatsApp/SMS. Continued use of
          services after changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="11. Contact">
        <p>
          For any questions, concerns, or disputes regarding these Terms &amp;
          Conditions, please contact the respective branch owner using the contact
          information below.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
