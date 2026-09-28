import LegalLayout from "@/app/components/legal-layout";
import { LegalSection, LegalCallout, LegalSubSection } from "@/app/components/legal-ui";
import { Shield, Database, Users, Lock, Eye, HardDrive } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
  description:
    "Brothers Gym privacy policy — how we collect, use, and protect your personal and health information.",
};

// Drives the "On this page" rail. Order and ids must match the LegalSection
// ids below.
const SECTIONS = [
  { id: "collect", label: "1. Information We Collect" },
  { id: "use", label: "2. How We Use It" },
  { id: "security", label: "3. Data Security" },
  { id: "third-parties", label: "4. Third-Party Services" },
  { id: "rights", label: "5. Your Rights" },
  { id: "retention", label: "6. Data Retention" },
  { id: "cookies", label: "7. Cookies & Tracking" },
  { id: "children", label: "8. Children's Privacy" },
  { id: "changes", label: "9. Changes to This Policy" },
  { id: "contact", label: "10. Contact" },
];

export default async function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="How Brothers Gym collects, uses, and protects your personal information."
      sections={SECTIONS}
      currentPath="/privacy"
    >
      <LegalCallout variant="note" title="Your privacy matters">
        <p>
          We handle your personal and health data with utmost care and in compliance with
          Indian data protection laws (IT Act 2000, DPDP Act 2023). You have full rights
          over your data at all times.
        </p>
      </LegalCallout>

      <LegalSection id="collect" icon={<Database size={18} />} title="1. Information We Collect">
        <p>
          When you become a member of Brothers Gym or use our website, we collect the
          following information:
        </p>

        <LegalSubSection title="Personal Information">
          <ul>
            <li>Full name and Father&apos;s name</li>
            <li>Phone number (Ph.No)</li>
            <li>Residential address</li>
            <li>Email address (optional)</li>
            <li>Emergency contact number</li>
            <li>Age and gender (if provided)</li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="Health & Fitness Information">
          <ul>
            <li>Weight and height (for BMI, if you use our BMI calculator)</li>
            <li>Medical conditions or injuries (if you disclose them)</li>
            <li>Fitness goals and workout preferences</li>
            <li>Attendance and gym visit records</li>
          </ul>
          <p className="text-sm text-zinc-500">
            Providing health information is optional but recommended for your safety.
          </p>
        </LegalSubSection>

        <LegalSubSection title="Payment & Membership Information">
          <ul>
            <li>Membership plan type and duration</li>
            <li>Fees paid and payment method</li>
            <li>Joining date and expiry date</li>
            <li>Payment transaction records (UPI reference / UTR number)</li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="Technical Information">
          <ul>
            <li>IP address (for security purposes)</li>
            <li>Browser type and device information</li>
            <li>Login attempts and timestamps</li>
          </ul>
        </LegalSubSection>
      </LegalSection>

      <LegalSection id="use" icon={<Users size={18} />} title="2. How We Use Your Information">
        <ul>
          <li>
            <strong className="text-white">Membership Management:</strong> To create and
            manage your gym membership, track expiry, and process renewals.
          </li>
          <li>
            <strong className="text-white">Communication:</strong> To send you WhatsApp or
            SMS reminders about membership renewals, payment confirmations, and important
            updates.
          </li>
          <li>
            <strong className="text-white">Payment Processing:</strong> To confirm online
            UPI payments made directly to the gym&apos;s UPI account and activate your
            membership.
          </li>
          <li>
            <strong className="text-white">Safety &amp; Emergency:</strong> To contact
            your emergency contact in case of any medical emergency at the gym.
          </li>
          <li>
            <strong className="text-white">Legal Compliance:</strong> To comply with any
            legal, tax, or regulatory requirements.
          </li>
          <li>
            <strong className="text-white">Service Improvement:</strong> To improve our
            gym services, equipment, and member experience.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="security" icon={<Lock size={18} />} title="3. Data Security">
        <p>
          We take security seriously. Your data is protected by industry-standard
          measures:
        </p>
        <ul>
          <li>
            <strong className="text-white">Encrypted Storage:</strong> All data is stored
            in encrypted PostgreSQL databases.
          </li>
          <li>
            <strong className="text-white">Password Protection:</strong> All passwords are
            hashed using bcrypt (industry standard, cannot be reversed).
          </li>
          <li>
            <strong className="text-white">HTTPS Encryption:</strong> All data transfer is
            encrypted via HTTPS/TLS.
          </li>
          <li>
            <strong className="text-white">Rate Limiting:</strong> Login attempts are
            rate-limited to prevent brute force attacks.
          </li>
          <li>
            <strong className="text-white">Two-Factor Authentication (2FA):</strong> Owner
            accounts use OTP verification via email for login.
          </li>
          <li>
            <strong className="text-white">Access Control:</strong> Only authorized staff
            can access member data, with granular permissions per staff.
          </li>
          <li>
            <strong className="text-white">Session Management:</strong> Auto-logout after
            30 minutes of inactivity.
          </li>
          <li>
            <strong className="text-white">Bot Protection:</strong> Cloudflare Turnstile
            protects login pages from bot attacks.
          </li>
          <li>
            <strong className="text-white">No Card Details Collected:</strong> Online
            payments are made by UPI inside your own UPI app. We never see or store your
            card, bank, or UPI PIN details — only the amount and an optional reference
            number you share to help us confirm the payment.
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="third-parties"
        icon={<Users size={18} />}
        title="4. Third-Party Services"
      >
        <p>
          We use trusted third-party services to run our platform. Each is RBI-approved or
          compliant with Indian data protection standards:
        </p>
        <ul>
          <li>
            <strong className="text-white">UPI Apps &amp; Banks:</strong> Online payments
            are made by UPI directly from your app (Google Pay, PhonePe, Paytm, or your
            bank) to the gym&apos;s UPI account, over India&apos;s RBI-operated UPI
            network. We never see or store your payment credentials.
          </li>
          <li>
            <strong className="text-white">Resend:</strong> For sending OTP verification
            emails and password reset codes.
          </li>
          <li>
            <strong className="text-white">MSG91:</strong> DLT-approved SMS provider for
            sending membership reminders (if enabled).
          </li>
          <li>
            <strong className="text-white">Google Maps:</strong> For displaying gym
            location and directions.
          </li>
          <li>
            <strong className="text-white">Cloudflare:</strong> For bot protection on
            login pages.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" icon={<Eye size={18} />} title="5. Your Rights">
        <p>You have the following rights over your personal data:</p>
        <ul>
          <li>
            <strong className="text-white">Right to Access:</strong> Request a copy of all
            data we have about you.
          </li>
          <li>
            <strong className="text-white">Right to Correction:</strong> Request
            correction of any inaccurate information.
          </li>
          <li>
            <strong className="text-white">Right to Deletion:</strong> Request deletion of
            your data after your membership ends (subject to legal retention
            requirements).
          </li>
          <li>
            <strong className="text-white">Right to Opt-Out:</strong> Opt out of marketing
            SMS/WhatsApp reminders at any time.
          </li>
          <li>
            <strong className="text-white">Right to Portability:</strong> Request your
            data in a portable format (Excel/CSV).
          </li>
        </ul>
        <p>
          To exercise any of these rights, contact the branch owner directly (see contact
          section below).
        </p>
      </LegalSection>

      <LegalSection id="retention" icon={<HardDrive size={18} />} title="6. Data Retention">
        <ul>
          <li>Active member data is retained for the duration of your membership.</li>
          <li>
            Inactive/expired member data is retained for up to 3 years for legal, tax, and
            business analytics purposes.
          </li>
          <li>Payment records are retained for 8 years as required by Indian tax laws.</li>
          <li>
            Login logs and security data is retained for 1 year for security auditing.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" title="7. Cookies & Tracking">
        <p>We use minimal cookies necessary for the website to function:</p>
        <ul>
          <li>
            <strong className="text-white">Authentication cookies:</strong> To keep you
            logged in.
          </li>
          <li>
            <strong className="text-white">Session cookies:</strong> To maintain your
            session state.
          </li>
          <li>
            <strong className="text-white">CSRF protection cookies:</strong> To protect
            against cross-site request forgery attacks.
          </li>
        </ul>
        <p>
          We do NOT use third-party tracking cookies, ad networks, or analytics that share
          your data with third parties.
        </p>
      </LegalSection>

      <LegalSection id="children" title="8. Children's Privacy">
        <p>
          Members under 18 years of age require parental/guardian consent. We collect the
          Father&apos;s Name specifically for this purpose. Parents can request access or
          deletion of their child&apos;s data at any time.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="9. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Any material changes will
          be notified to active members via WhatsApp/SMS. Continued use of our services
          after changes constitutes acceptance of the updated policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" icon={<Shield size={18} />} title="10. Contact for Privacy Concerns">
        <p>
          For any privacy-related queries, data access requests, or complaints, please
          contact the branch owner directly using the contact information below.
        </p>
        <LegalCallout variant="neutral">
          <p>
            <strong className="text-yellow-500">Grievance Officer:</strong> The respective
            branch owner (see contact section below).
          </p>
          <p>
            <strong className="text-yellow-500">Response Time:</strong> Within 30 days as
            per DPDP Act 2023.
          </p>
        </LegalCallout>
      </LegalSection>
    </LegalLayout>
  );
}
