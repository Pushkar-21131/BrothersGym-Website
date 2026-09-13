"use client";

import { useState, useEffect, useRef } from "react";
import Script from "next/script";
import toast from "react-hot-toast";
import {
  createOnlineJoinOrder,
  verifyOnlinePayment,
  lookupMemberSecure,
  getPublicPlansForBranch,
  createJoinLead,
} from "@/app/actions/payments";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { CHECKOUT_LOGO_DATA_URI } from "@/lib/checkout-logo";
import TurnstileWidget from "@/app/components/turnstile-widget";

declare global {
  interface Window {
    Razorpay: any;
  }
}

type Branch = {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
};

type Plan = {
  id: number;
  code: string;
  name: string;
  price: number;
  durationDays: number;
  description: string | null;
  includesCardio: boolean;
};

type VerifiedMember = {
  id: number;
  gymId: number;
  branchId: number;
  name: string;
  contactNumber: string;
  currentExpiry: string;
  lastPlan: string | null;
};

// Everything the fallback contact screen needs, returned by createJoinLead.
//
// No UPI fields, no QR, no payable amount to transfer anywhere: on this path the
// member pays the owner directly, off the website entirely. What they get is a
// reference to quote and two ways to reach the gym.
type LeadInfo = {
  joinId: number;
  reference: string;
  amount: number;
  planName: string;
  planDurationDays: number;
  branchName: string;
  branchPhone: string | null;
  branchAddress: string;
  email: string | null;
  isRenewal: boolean;
  phone: string;
  /** Their own name — the owner needs to know who they're calling. */
  memberName: string;
  /**
   * Why they landed here, which is the only thing that changes on the screen:
   *   off        online payment is switched off for the whole site
   *   failed     the gateway couldn't start, or wouldn't open
   *   dismissed  they closed the checkout without paying
   *
   * "dismissed" is the one case where the member chose this, so it must not read
   * like an apology for a broken website.
   */
  reason: "off" | "failed" | "dismissed";
};

/** What the gateway hands back once a payment is captured and verified. */
type PaidInfo = {
  gymId: number;
  expiry: string;
  amount: number;
  memberName: string;
  planName?: string;
  branchName: string;
  isRenewal: boolean;
  /** The address the confirmation went to, or null when none was sent. */
  emailedTo: string | null;
};

export default function JoinPlansClient({
  initialBranches,
  paymentMode = "razorpay",
}: {
  initialBranches: Branch[];
  paymentMode?: "razorpay" | "contact";
}) {
  // Steps 1–3 are the funnel (branch → plan → details). 4 = contact the gym
  // (online payment didn't happen), 5 = paid and confirmed.
  //
  // Only ONE of 4 and 5 is ever reachable for a given attempt, and which one is
  // decided by whether money moved: the gateway's success handler jumps to 5,
  // every way of not paying lands on 4. Step 4 no longer takes any payment, so
  // there is no path from 4 to 5.
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [memberType, setMemberType] = useState<"new" | "renewal">("new");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [planFilter, setPlanFilter] = useState<"cardio" | "hardcore">("cardio");

  const [searchGymId, setSearchGymId] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [verified, setVerified] = useState<VerifiedMember | null>(null);

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string>("");
  const [consentChecked, setConsentChecked] = useState(false);

  // Captcha, required before the form will submit.
  //
  // Only createJoinLead verifies the token server-side — it is the action that
  // sends email, and email is the resource worth protecting. But the token is
  // demanded on EVERY submit, including the gateway path, because the gateway
  // path falls back to createJoinLead the moment Razorpay is unreachable. A
  // token gathered only on the fallback would mean asking someone to solve a
  // captcha after their payment already failed, which is the worst possible
  // moment to add a step.
  //
  // captchaKey remounts the widget. Turnstile tokens are single-use, so once a
  // submit has spent one the widget has to be reset before the next attempt or
  // a retry is rejected for a reason the member cannot see.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);

  // Fallback (contact-the-owner) flow state.
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null);
  // Set when the gateway captured the payment — this is what step 5 renders.
  const [paidInfo, setPaidInfo] = useState<PaidInfo | null>(null);

  // Guard against a stale response overwriting plans after the user switches
  // branch (or navigates away) mid-fetch. The initial reset is an intentional
  // sync of external (server) plan data to the selected branch.
  const requestIdRef = useRef(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedBranch) return;
    const requestId = ++requestIdRef.current;
    setPlans([]);
    setPlansLoading(true);
    getPublicPlansForBranch(selectedBranch.id)
      .then((p) => {
        if (requestIdRef.current !== requestId) return;
        setPlans(p);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setPlans([]);
        toast.error("Failed to load plans. Please try again.");
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setPlansLoading(false);
      });
  }, [selectedBranch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Filter plans by cardio/hardcore
  const filteredPlans = plans.filter((p) =>
    planFilter === "cardio" ? p.includesCardio : !p.includesCardio
  );

  function goToStep(next: 1 | 2 | 3 | 4 | 5) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // The 350ms delay before advancing a step lets the selected card finish its
  // press animation. Held in a ref and cleared on unmount so it can't fire
  // setState after the user has left the page, and so double-tapping two cards
  // in quick succession doesn't queue two competing step changes.
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function goToStepAfterAnimation(next: 1 | 2 | 3 | 4 | 5) {
    if (stepTimer.current) clearTimeout(stepTimer.current);
    stepTimer.current = setTimeout(() => goToStep(next), 350);
  }

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
    };
  }, []);

  function selectBranch(b: Branch) {
    setSelectedBranch(b);
    setSelectedPlan(null);
    setMemberType("new");
    setVerified(null);
    setSearchGymId("");
    setSearchPhone("");
    setPlanFilter("cardio");
    goToStepAfterAnimation(2);
  }

  function selectPlan(plan: Plan) {
    // 🔒 SECURITY: Force verification for renewal users
    if (memberType === "renewal" && !verified) {
      toast.error("Please verify your identity first (see the box above).");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSelectedPlan(plan);
    goToStepAfterAnimation(3);
  }

  function backToBranch() {
    setSelectedBranch(null);
    setSelectedPlan(null);
    setPlans([]);
    setVerified(null);
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Full reset back to the start — used by "start again" on the contact and
  // success screens.
  function resetAll() {
    setSelectedBranch(null);
    setSelectedPlan(null);
    setPlans([]);
    setVerified(null);
    setMemberType("new");
    setSearchGymId("");
    setSearchPhone("");
    setLeadInfo(null);
    setPaidInfo(null);
    setConsentChecked(false);
    setFormError("");
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchToRenewal() {
    setMemberType("renewal");
    setSelectedPlan(null);
  }

  function switchToNew() {
    setMemberType("new");
    setSelectedPlan(null);
    setVerified(null);
    setSearchGymId("");
    setSearchPhone("");
  }

  async function handleLookup() {
    if (!selectedBranch) return;
    if (!searchGymId.trim()) return toast.error("Enter your Gym ID");
    if (!searchPhone.trim() || searchPhone.trim().length < 10)
      return toast.error("Enter your registered 10-digit phone number");

    setLookupLoading(true);
    const result = await lookupMemberSecure(
      searchGymId,
      searchPhone,
      selectedBranch.id
    );
    setLookupLoading(false);

    if (result.error) {
      toast.error(result.error);
      setVerified(null);
      return;
    }

    setVerified(result.member as VerifiedMember);
    toast.success(`✓ Verified: ${result.member!.name}`);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy — please select and copy it manually.");
    }
  }

  // Pre-filled WhatsApp message the member sends the gym.
  //
  // The direction matters: the MEMBER sends it, from their own WhatsApp, by
  // tapping a wa.me link. Sending WhatsApp *from* the gym automatically would
  // mean a business API, a dedicated number the owner can't use in the normal
  // app, and a monthly bill — none of which fits a gym on a free tier. Inverting
  // it costs nothing, needs no setup from the owner, and lands in the one app he
  // actually watches.
  //
  // It no longer claims a payment. The old wording — "I've paid ₹X via UPI and
  // uploaded my payment screenshot" — described a flow that no longer exists,
  // and on this path the member has paid nothing at all. Saying otherwise would
  // put the owner in exactly the argument this rewrite exists to prevent.
  function ownerWhatsAppLink(info: LeadInfo): string {
    const msg =
      `Hi Brothers Gym! I've filled the ${info.planName} ` +
      `${info.isRenewal ? "renewal" : "membership"} form on your website` +
      `${info.branchName ? ` for ${info.branchName}` : ""}, but I couldn't pay ` +
      `online.\n\n` +
      `Reference: ${info.reference}\n` +
      `Name: ${info.memberName}\n` +
      `Phone: ${info.phone}\n` +
      `Amount: ₹${info.amount.toLocaleString("en-IN")}\n\n` +
      `Please let me know how to pay. Thank you! 🙏`;
    return buildWhatsAppLink(info.branchPhone || "", msg);
  }

  /**
   * Show the contact-the-owner screen for a join row that ALREADY exists.
   *
   * This is the case where the gateway got far enough to create the row and then
   * stopped — checkout wouldn't open, or the member closed the modal without
   * paying. It deliberately does not call createJoinLead: that would insert a
   * second row and leave the owner two entries to chase for one person.
   *
   * No owner email fires here either, for the same reason — the alert already
   * belongs to whichever write created the row. An abandoned checkout still
   * shows up in the owner's Join Requests queue as `pending`.
   */
  function showContactScreen(info: LeadInfo) {
    setLeadInfo(info);
    goToStep(4);
  }

  /**
   * Save the member's details as a lead, then show the contact screen.
   *
   * For the case where NO join row exists yet. Safe to call straight after a
   * failed createOnlineJoinOrder: that action creates the Razorpay order before
   * it inserts the join row (see src/app/actions/payments.ts), so an order
   * failure leaves nothing behind and this writes the one and only row.
   *
   * createJoinLead is what emails the owner, so this is also the point at which
   * they learn someone is waiting for a call.
   */
  async function fallbackToContact(
    formData: FormData,
    reason: LeadInfo["reason"],
    who: { phone: string; memberName: string }
  ) {
    const res = await createJoinLead(formData);

    // The token is spent either way — Turnstile tokens are single-use, and
    // createJoinLead redeems it before it does anything else. Reset the widget
    // now so a retry after an error has a fresh one instead of failing on a
    // captcha the member already solved.
    setCaptchaToken("");
    setCaptchaKey((k) => k + 1);

    if ("error" in res) {
      const msg =
        res.error ||
        "Couldn't save your details. Please call the gym and they'll sign you up.";
      toast.error(msg);
      setFormError(msg);
      return;
    }

    showContactScreen({
      joinId: res.joinId,
      reference: res.reference,
      amount: res.amount,
      planName: res.planName,
      planDurationDays: res.planDurationDays,
      branchName: res.branchName,
      branchPhone: res.branchPhone,
      branchAddress: res.branchAddress,
      email: res.email,
      isRenewal: res.isRenewal,
      phone: who.phone,
      memberName: who.memberName,
      reason,
    });
  }

  async function handleContinue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    if (!selectedBranch || !selectedPlan) {
      setFormError("Please pick a branch and plan first.");
      return;
    }

    if (memberType === "renewal" && !verified) {
      setFormError("Please verify your identity before payment.");
      return;
    }

    if (!consentChecked) {
      setFormError("Please accept the Data & Health Consent to continue.");
      return;
    }

    if (!captchaToken) {
      setFormError("Please complete the security check below.");
      return;
    }

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);
    formData.set("planCode", selectedPlan.code);
    formData.set("joinType", memberType);
    formData.set("branchId", String(selectedBranch.id));
    formData.set("consentToHealthData", "true");
    formData.set("captchaToken", captchaToken);

    if (memberType === "renewal" && verified) {
      formData.set("existingMemberId", String(verified.id));
    }

    // The two fields the contact screen and its WhatsApp message need, read here
    // because the server's reply carries neither back (the phone number is
    // masked everywhere it is returned, and it is the number the owner has to
    // dial).
    const who = {
      phone: String(formData.get("contactNumber") || "").trim(),
      memberName: String(formData.get("name") || "").trim(),
    };

    // ===== NO GATEWAY AT ALL (PAYMENT_MODE=contact) =====
    // The site-wide kill switch. checkout.js was never loaded and the CSP does
    // not allow Razorpay's hosts, so there is nothing to attempt — straight to
    // the lead queue. This is the mode to deploy on while KYC is pending.
    if (paymentMode === "contact") {
      setLoading(true);
      await fallbackToContact(formData, "off", who);
      setLoading(false);
      return;
    }

    // ===== THE GATEWAY, WITH A LANDING PAD =====
    // Razorpay is the payment method. Three things can still stop a member
    // paying, and none of them may end in a dead end that throws away a filled
    // form:
    //
    //   1. checkout.js never loaded        — blocked, offline, ad-blocker
    //   2. the order call failed           — keys unset, Razorpay down
    //   3. the member closed the modal     — changed their mind, card declined
    //
    // (1) and (2) happen before any join row exists, so they save one via
    // createJoinLead. (3) happens after, so it reuses the row the order already
    // created. That split is the whole reason showContactScreen and
    // fallbackToContact are separate functions.
    if (typeof window.Razorpay !== "function") {
      setLoading(true);
      await fallbackToContact(formData, "failed", who);
      setLoading(false);
      return;
    }

    setLoading(true);
    const order = await createOnlineJoinOrder(formData);

    if (order.error || !order.orderId) {
      await fallbackToContact(formData, "failed", who);
      setLoading(false);
      return;
    }
    setLoading(false);

    // The landing pad for cases (3) and (4-in-practice: Razorpay's own script
    // throwing on open). Built from the order response so it describes the row
    // that already exists rather than creating another.
    const existingRow: LeadInfo = {
      joinId: order.joinId!,
      reference: order.reference!,
      amount: order.planPrice!,
      planName: order.planName || selectedPlan.name,
      planDurationDays: order.planDurationDays ?? selectedPlan.durationDays,
      branchName: order.branchName || selectedBranch.name,
      branchPhone: order.branchPhone ?? selectedBranch.phone,
      branchAddress: order.branchAddress || selectedBranch.address,
      email: order.customer?.email || null,
      isRenewal: Boolean(order.isRenewal),
      phone: who.phone,
      memberName: who.memberName,
      reason: "dismissed",
    };

    try {
      const rzp = new window.Razorpay({
        key: order.key,
        amount: order.amount,
        currency: order.currency,
        name: `Brothers Gym - ${order.branchName}`,
        description: order.planName,
        // Razorpay draws a placeholder tile with the first letter of `name` in
        // it — a bare "B" — whenever it cannot load this image. Checkout runs in
        // an iframe on Razorpay's own HTTPS origin and fetches the image from
        // there, so a URL has to be publicly reachable over HTTPS: on localhost
        // it never is, and an SVG is ignored regardless because the tile is
        // rasterised. An inline base64 PNG sidesteps the network entirely and
        // behaves the same locally, on deploy previews and in production.
        image: CHECKOUT_LOGO_DATA_URI,
        order_id: order.orderId,
        prefill: {
          name: order.customer?.name,
          email: order.customer?.email,
          contact: order.customer?.contact,
        },
        theme: { color: "#F5A623" },
        // Razorpay calls this when the member dismisses the checkout overlay
        // without completing payment. Without it the member is dropped back onto
        // the form they just filled with no idea what happened to it, and the
        // owner has a pending row nobody explains. Note it also fires *after* a
        // successful payment on some flows, so it must not clobber step 5 —
        // hence the paidInfo guard.
        modal: {
          ondismiss: function () {
            setPaidInfo((paid) => {
              if (!paid) showContactScreen(existingRow);
              return paid;
            });
          },
        },
        handler: async function (response: any) {
          const result = await verifyOnlinePayment({
            joinId: order.joinId!,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });

          if (result.success !== true) {
            // The money may well have left their account — the webhook is the
            // safety net that grants the membership regardless of what happened
            // in this browser, so the one thing not to tell them is "pay again".
            toast.error(result.error);
            setFormError(result.error);
            return;
          }

          // ===== ON-SCREEN SUCCESS, NOT A window.confirm =====
          // This used to fire a native confirm() and then window.open() a wa.me
          // link — built from result.contactNumber, which is the MEMBER's own
          // number, so it opened a chat with themselves. It was also inside an
          // async callback, which is precisely what popup blockers eat, and it
          // left no copy of the Gym ID anywhere on the page. Now the Gym ID is
          // rendered on step 5, and the email (when they gave an address) is
          // sent server-side by verifyOnlinePayment.
          setPaidInfo({
            gymId: result.gymId,
            expiry: result.expiry,
            amount: result.amount,
            memberName: result.memberName,
            planName: result.planName,
            branchName: order.branchName || selectedBranch.name,
            isRenewal: memberType === "renewal",
            emailedTo: result.emailedTo ?? null,
          });
          toast.success(`Payment successful! Gym ID #${result.gymId}`);
          goToStep(5);
        },
      });

      rzp.open();
    } catch (err) {
      // The script loaded but would not run — a broken build served from their
      // ISP's cache, an extension monkey-patching it, an old WebView. The row is
      // already there, so send them to the contact screen rather than nowhere.
      console.error("[Razorpay] checkout failed to open:", err);
      showContactScreen({ ...existingRow, reason: "failed" });
    }
  }

  const renewalBlocked = memberType === "renewal" && !verified;

  return (
    <>
      {/* Razorpay's checkout script. Skipped entirely under PAYMENT_MODE=contact,
          which is the only mode that ships no third-party JS — and the only one
          where next.config.ts leaves Razorpay's hosts out of the CSP, so loading
          it there would be blocked anyway. */}
      {paymentMode !== "contact" && (
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />
      )}

      <div className="bg-effects">
        <div className="bg-orb bg-orb-1"></div>
        <div className="bg-orb bg-orb-2"></div>
        <div className="bg-orb bg-orb-3"></div>
      </div>
      <div className="bg-grid"></div>

      <div className="join-container">
        {/* HEADER */}
        <div className="join-header">
          <div className="header-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6.5 6.5h11v11h-11z" />
              <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
            </svg>
            Brothers Gym — Online Enrollment
          </div>
          <h1>
            Join <span className="highlight">Brothers Gym</span> Online
          </h1>
          <p>
            {paymentMode === "contact"
              ? "Pick your preferred branch and plan, fill in your details, and the gym will call you to take the payment."
              : "Pick your preferred branch and plan. Pay securely via UPI, Cards or Netbanking."}
          </p>
          {/* Advertising payment methods the site cannot actually take is how you
              get an argument at the counter, so the whole row goes when the
              gateway is off — including the UPI badge, which used to stay up and
              promise a UPI flow that no longer exists. */}
          {paymentMode !== "contact" && (
            <div className="payment-icons">
              <div className="payment-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                UPI
              </div>
              <div className="payment-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                Cards
              </div>
              <div className="payment-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" />
                </svg>
                Netbanking
              </div>
            </div>
          )}
        </div>

        {/* PROGRESS BAR — only for the funnel (steps 1–3) */}
        {step <= 3 && (
          <div className="progress-bar">
            <div className="progress-step">
              <div className={`step-circle ${step === 1 ? "active" : step > 1 ? "completed" : ""}`}>
                {step > 1 ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : "1"}
              </div>
              <span className={`step-label ${step === 1 ? "active" : step > 1 ? "completed" : ""}`}>Branch</span>
            </div>
            <div className={`step-connector ${step > 1 ? "filled" : ""}`}>
              <div className="fill"></div>
            </div>
            <div className="progress-step">
              <div className={`step-circle ${step === 2 ? "active" : step > 2 ? "completed" : ""}`}>
                {step > 2 ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : "2"}
              </div>
              <span className={`step-label ${step === 2 ? "active" : step > 2 ? "completed" : ""}`}>Plan</span>
            </div>
            <div className={`step-connector ${step > 2 ? "filled" : ""}`}>
              <div className="fill"></div>
            </div>
            <div className="progress-step">
              <div className={`step-circle ${step === 3 ? "active" : ""}`}>3</div>
              <span className={`step-label ${step === 3 ? "active" : ""}`}>Details</span>
            </div>
          </div>
        )}

        {/* STEP 1: BRANCH */}
        {step === 1 && (
          <div>
            <div className="section-title">
              <span className="step-num">1</span>
              Choose Your Branch
            </div>
            <p className="section-subtitle">Both branches offer premium equipment and expert trainers.</p>

            {initialBranches.length === 0 ? (
              <div className="text-center text-zinc-500 py-12">
                No branches available. Please contact us directly.
              </div>
            ) : (
              <div className="branch-grid">
                {initialBranches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => selectBranch(b)}
                    className={`branch-card ${selectedBranch?.id === b.id ? "selected" : ""}`}
                  >
                    <div className="selected-check">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div className="branch-header">
                      <div className="branch-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
                        </svg>
                      </div>
                      <div>
                        <div className="branch-name">{b.name}</div>
                        <div className="branch-code">{b.code}</div>
                      </div>
                    </div>
                    <div className="branch-detail">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>{b.address}</span>
                    </div>
                    {b.phone && (
                      <div className="branch-detail">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                        </svg>
                        <span>{b.phone}</span>
                      </div>
                    )}
                    <div className="branch-select-btn">
                      Choose this branch
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: PLAN */}
        {step === 2 && selectedBranch && (
          <div>
            <div className="selected-branch-banner">
              <div className="selected-branch-info">
                <div className="branch-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
                  </svg>
                </div>
                <div>
                  <div className="selected-branch-label">Joining at</div>
                  <div className="selected-branch-name">
                    {selectedBranch.name} <span>({selectedBranch.code})</span>
                  </div>
                </div>
              </div>
              <button type="button" className="change-branch-btn" onClick={backToBranch}>
                Change<span className="btn-more"> branch</span>
              </button>
            </div>

            {/* Toggle */}
            <div className="toggle-container">
              <div className={`toggle-slider ${memberType === "renewal" ? "right" : ""}`}></div>
              <button
                type="button"
                className={`toggle-btn ${memberType === "new" ? "active" : ""}`}
                onClick={switchToNew}
              >
                I&apos;m New Here
              </button>
              <button
                type="button"
                className={`toggle-btn ${memberType === "renewal" ? "active" : ""}`}
                onClick={switchToRenewal}
              >
                <span className="btn-more">Existing Member </span>Renewal
              </button>
            </div>

            {/* Verify Card — Mandatory for Renewal */}
            {memberType === "renewal" && (
              <div className="verify-card">
                <div className="verify-header">
                  <div className="verify-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <polyline points="9 12 11 14 15 10" />
                    </svg>
                  </div>
                  <div className="verify-title">Verify Your Identity</div>
                </div>
                <p className="verify-subtitle">
                  Enter your Gym ID (from {selectedBranch.name}) and registered phone number.
                  {!verified && (
                    <>
                      <br />
                      <span className="verify-required">
                        ⚠ Verification is required to select a renewal plan.
                      </span>
                    </>
                  )}
                </p>
                <div className="verify-fields">
                  <div className="form-group">
                    <label className="form-label" htmlFor="renew-gym-id">
                      Gym ID <span className="required">*</span>
                    </label>
                    <input
                      id="renew-gym-id"
                      name="gymId"
                      type="text"
                      autoComplete="off"
                      className="form-input"
                      placeholder="e.g. 2024001"
                      value={searchGymId}
                      onChange={(e) => setSearchGymId(e.target.value)}
                      disabled={!!verified}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="renew-phone">
                      Registered Phone <span className="required">*</span>
                    </label>
                    <input
                      id="renew-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      className="form-input"
                      placeholder="e.g. 9876543210"
                      value={searchPhone}
                      onChange={(e) => setSearchPhone(e.target.value)}
                      maxLength={10}
                      disabled={!!verified}
                    />
                  </div>
                </div>
                {!verified ? (
                  <button
                    type="button"
                    className="verify-btn"
                    onClick={handleLookup}
                    disabled={lookupLoading}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    {lookupLoading ? "Verifying..." : "Verify & Lookup"}
                  </button>
                ) : (
                  <div className="verified-info">
                    <div className="verified-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="20" height="20">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <strong>Identity Verified</strong>
                    </div>
                    <p>Name: <strong>{verified.name}</strong></p>
                    <p>Gym ID: #{verified.gymId}</p>
                    <p>Phone: {verified.contactNumber}</p>
                    <p>
                      Current Expiry:{" "}
                      <span className={new Date(verified.currentExpiry) < new Date() ? "expired" : ""}>
                        {verified.currentExpiry}
                        {new Date(verified.currentExpiry) < new Date() && " (EXPIRED)"}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setVerified(null);
                        setSearchGymId("");
                        setSearchPhone("");
                      }}
                      className="reverify-btn"
                    >
                      Verify different account
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Plans */}
            <div className={`plans-section ${renewalBlocked ? "blocked" : ""}`}>
              <div className="section-title">
                <span className="step-num">2</span>
                Select a Plan
              </div>
              <p className="section-subtitle">
                {renewalBlocked
                  ? "Complete verification above to unlock plans."
                  : "Choose your training style, then pick a duration."}
              </p>

              {/* Cardio / Hardcore Filter Tabs */}
              {!plansLoading && plans.length > 0 && (
                <div className="plan-filter-tabs">
                  <button
                    type="button"
                    className={`plan-filter-tab ${planFilter === "cardio" ? "active" : ""}`}
                    onClick={() => {
                      setPlanFilter("cardio");
                      setSelectedPlan(null);
                    }}
                    disabled={renewalBlocked}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    <span>Cardio</span>
                    <span className="tab-count">
                      {plans.filter((p) => p.includesCardio).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`plan-filter-tab ${planFilter === "hardcore" ? "active" : ""}`}
                    onClick={() => {
                      setPlanFilter("hardcore");
                      setSelectedPlan(null);
                    }}
                    disabled={renewalBlocked}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                      <path d="M6.5 6.5h11v11h-11z" />
                      <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
                    </svg>
                    <span>Hardcore</span>
                    <span className="tab-count">
                      {plans.filter((p) => !p.includesCardio).length}
                    </span>
                  </button>
                </div>
              )}

              {plansLoading ? (
                <div className="text-center text-zinc-500 py-12">Loading plans...</div>
              ) : plans.length === 0 ? (
                <div className="text-center text-zinc-500 py-12">
                  No plans available. Please contact us.
                </div>
              ) : filteredPlans.length === 0 ? (
                <div className="text-center text-zinc-500 py-12">
                  No {planFilter === "cardio" ? "cardio" : "hardcore"} plans available for this branch.
                </div>
              ) : (
                <div className="plans-grid">
                  {filteredPlans.map((p: Plan, idx: number) => {
                    let badge: string | null = null;
                    if (p.durationDays >= 89 && p.durationDays <= 91) badge = "Popular";
                    if (p.durationDays >= 360) badge = "Best Value";
                    const isSelected = selectedPlan?.id === p.id;

                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`plan-card ${isSelected ? "selected" : ""}`}
                        onClick={() => selectPlan(p)}
                        style={{ animationDelay: `${idx * 0.05}s` }}
                        disabled={renewalBlocked}
                      >
                        <div className="plan-main">
                          <div className="plan-name">{p.name}</div>
                          <div className="plan-price">
                            <span className="currency">₹</span>
                            <span className="amount">{p.price.toLocaleString("en-IN")}</span>
                            <span className="period">/ {p.durationDays} days</span>
                          </div>
                          <div className="plan-desc">
                            {p.description ||
                              (p.includesCardio ? "Includes cardio & treadmill" : "Weights & strength only")}
                          </div>
                        </div>
                        {/* The tag sits beside the radio now, so it no longer has to
                            hide when the row is selected to stay out of its way. */}
                        <div className="plan-aside">
                          {badge && <div className="plan-badge">{badge}</div>}
                          <div className="plan-check">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: DETAILS */}
        {step === 3 && selectedBranch && selectedPlan && (
          <div>
            <div className="selected-branch-banner">
              <div className="selected-branch-info">
                <div className="branch-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
                  </svg>
                </div>
                <div>
                  <div className="selected-branch-label">Joining at</div>
                  <div className="selected-branch-name">
                    {selectedBranch.name} <span>({selectedBranch.code})</span>
                  </div>
                </div>
              </div>
              <button type="button" className="change-branch-btn" onClick={backToBranch}>
                Change
              </button>
            </div>

            <div className="order-summary">
              <div className="order-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                Order Summary
              </div>
              <div className="order-row">
                <span className="label">Branch</span>
                <span className="value">{selectedBranch.name} ({selectedBranch.code})</span>
              </div>
              <div className="order-row">
                <span className="label">Member Type</span>
                <span className="value">{memberType === "new" ? "New Member" : "Renewal"}</span>
              </div>
              <div className="order-row">
                <span className="label">Plan</span>
                <span className="value">{selectedPlan.name}</span>
              </div>
              <div className="order-row">
                <span className="label">Duration</span>
                <span className="value">{selectedPlan.durationDays} days</span>
              </div>
              <div className="order-row total">
                <span className="label">Total Amount</span>
                <span className="value">₹{selectedPlan.price.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <form onSubmit={handleContinue}>
              <div className="form-card">
                <div className="form-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Your Details
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">
                      Full Name <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      className="form-input"
                      placeholder="Enter your full name"
                      defaultValue={verified?.name || ""}
                      readOnly={memberType === "renewal" && !!verified}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Contact Number <span className="required">*</span>
                    </label>
                    <input
                      type="tel"
                      name="contactNumber"
                      className="form-input"
                      placeholder="10-digit mobile number"
                      defaultValue={memberType === "renewal" ? searchPhone : ""}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Emergency Contact <span className="required">*</span>
                    </label>
                    <input
                      type="tel"
                      name="emergencyContact"
                      className="form-input"
                      placeholder="Emergency contact number"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Email <span className="optional">(optional)</span>
                    </label>
                    <input type="email" name="email" className="form-input" placeholder="your@email.com" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Parent / Father Name <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      name="parentName"
                      className="form-input"
                      placeholder="Guardian name"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Date of Birth <span className="optional">(optional)</span>
                    </label>
                    <input type="date" name="dob" className="form-input" />
                  </div>
                  <div className="form-group full-width">
                    <label className="form-label">
                      Address <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      name="address"
                      className="form-input"
                      placeholder="Your complete address"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Consent Checkbox */}
              <div className="consent-box">
                <label>
                  <input
                    id="join-consent"
                    name="consent"
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    required
                  />
                  <div>
                    <p className="consent-title">Data & Health Consent (Required)</p>
                    <p className="consent-text">
                      I agree that Brothers Gym may collect and store my personal information
                      (name, phone, address, emergency contact) and any health-related information
                      for membership management and safety purposes. I have read and accept the{" "}
                      <a href="/privacy" target="_blank">Privacy Policy</a> and{" "}
                      <a href="/terms" target="_blank">Terms & Conditions</a>. I understand that
                      fees are <strong className="non-refundable">non-refundable</strong> once paid.
                    </p>
                  </div>
                </label>
              </div>

              {/* Security check.
                  Placed directly under the consent box and above the trust
                  badges, so it reads as the last thing before submitting
                  rather than an interruption in the middle of the fields.
                  key={captchaKey} remounts it after a submit has spent the
                  token — see the captchaToken state for why. */}
              <div className="consent-box" key={captchaKey}>
                <TurnstileWidget
                  onVerify={(token) => {
                    setCaptchaToken(token);
                    if (token) setFormError("");
                  }}
                  action="join"
                  theme="dark"
                />
              </div>

              {/* SUBTLE TRUST BADGES — Monochrome yellow */}
              <div className="trust-strip">
                <div className="trust-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <div>
                    <p className="trust-title">SSL Secured</p>
                    <p className="trust-sub">256-bit HTTPS</p>
                  </div>
                </div>
                {paymentMode !== "contact" ? (
                  <>
                    <div className="trust-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <div>
                        <p className="trust-title">Razorpay</p>
                        <p className="trust-sub">RBI Approved</p>
                      </div>
                    </div>
                    <div className="trust-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <div>
                        {/* Razorpay holds this certification, not Brothers Gym.
                            Dropping the attribution reads as a claim about us. */}
                        <p className="trust-title">PCI-DSS</p>
                        <p className="trust-sub">Razorpay Level 1</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="trust-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <rect x="1" y="4" width="22" height="16" rx="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                      </svg>
                      <div>
                        <p className="trust-title">Pay at the gym</p>
                        <p className="trust-sub">Cash or UPI, in person</p>
                      </div>
                    </div>
                    <div className="trust-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                      <div>
                        <p className="trust-title">Nothing charged</p>
                        <p className="trust-sub">Not a rupee online</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="trust-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                  <div>
                    <p className="trust-title">No Hidden Fees</p>
                    <p className="trust-sub">Transparent pricing</p>
                  </div>
                </div>
              </div>

              {formError && <div className="form-error">⚠ {formError}</div>}

              <button
                type="submit"
                className="submit-btn"
                disabled={loading || !consentChecked || !captchaToken}
              >
                {loading ? (
                  <>
                    <svg
                      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                    {paymentMode === "contact" ? "Saving your details..." : "Opening payment..."}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="4" width="22" height="16" rx="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    {paymentMode === "contact" ? "Send My Details" : "Pay & Join Now"}
                  </>
                )}
              </button>

              <div className="secure-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                {paymentMode === "contact"
                  ? "No payment is taken on this page. Your details go to the gym and you pay them directly."
                  : "Your payment is processed by Razorpay. We never see or store card/UPI details."}
              </div>
            </form>
          </div>
        )}

        {/* ==================================================================
            STEP 4 — CONTACT THE GYM

            The only screen a member sees when money did NOT move online. There
            is deliberately nothing here to pay with: no UPI ID, no QR code, no
            "transfer ₹X to this account", and no way to tell us you've paid.
            That whole apparatus is what created the argument this rewrite
            removes — a member insisting they'd transferred the money and an
            owner with no way to check.

            What it does give them: the reference, the branch's phone and
            WhatsApp, and where to walk in. The owner already has an email about
            them (createJoinLead sends it) and their row in Join Requests.
            ================================================================== */}
        {step === 4 && leadInfo && (
          <div>
            <div className="selected-branch-banner">
              <div className="selected-branch-info">
                <div className="branch-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </div>
                <div>
                  <div className="selected-branch-label">
                    {leadInfo.reason === "dismissed"
                      ? "Payment not completed"
                      : "Details saved — one call to finish"}
                  </div>
                  <div className="selected-branch-name">
                    {leadInfo.branchName || "Brothers Gym"}
                  </div>
                </div>
              </div>
            </div>

            {/* What happens next, and the one thing that must be unmissable:
                nothing was charged. A member who thinks they've paid stops
                expecting the call, then turns up believing they're a member. */}
            <div className="pay-not-configured">
              <strong>
                {leadInfo.reason === "dismissed"
                  ? "No payment was taken"
                  : "Online payment isn't available"}
              </strong>
              <p>
                {leadInfo.reason === "off"
                  ? "Card and UPI payments aren't switched on for this website yet, so "
                  : leadInfo.reason === "dismissed"
                    ? "You closed the payment window before it finished, so "
                    : "Something went wrong with the payment gateway, so "}
                <strong style={{ display: "inline", fontSize: "inherit" }}>
                  nothing has been charged
                </strong>
                {" — not a rupee. Your details are saved, so you don't have to fill "}
                the form again. Call or WhatsApp the gym, pay them directly, and
                they&apos;ll activate your membership straight away.
              </p>
              {leadInfo.branchAddress && (
                <p style={{ marginBottom: 0 }}>
                  Or just walk in: <strong style={{ display: "inline", fontSize: "inherit" }}>
                    {leadInfo.branchAddress}
                  </strong>
                </p>
              )}
            </div>

            {/* Two ways to reach the gym. The WhatsApp message is pre-filled with
                the reference, their name and the amount, so the owner can act on
                it without asking three follow-up questions. */}
            {(leadInfo.branchPhone || "").trim() ? (
              <div className="owner-actions">
                <a className="owner-btn" href={`tel:${leadInfo.branchPhone}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  <span className="owner-btn-label">
                    Call<span className="btn-more"> the gym</span>
                  </span>
                </a>
                <a
                  className="owner-btn whatsapp"
                  href={ownerWhatsAppLink(leadInfo)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.94 1.35-.5.05-1.13.24-3.66-.77-3.08-1.24-5.06-4.4-5.21-4.6-.15-.2-1.24-1.65-1.24-3.15s.79-2.24 1.07-2.54c.28-.3.61-.38.81-.38.2 0 .4 0 .58.01.19.01.44-.07.68.52.24.6.83 2.06.9 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.47.13.64-.08.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.71.81 2 .96.3.15.5.22.57.35.07.12.07.72-.17 1.4z" />
                  </svg>
                  <span className="owner-btn-label">
                    WhatsApp<span className="btn-more"> the gym</span>
                  </span>
                </a>
              </div>
            ) : (
              // No number on the branch record. Saying "call the gym" with
              // nothing to call would be worse than admitting we can't help.
              <div className="pay-not-configured">
                <p style={{ marginBottom: 0 }}>
                  We don&apos;t have a phone number on file for this branch. Please
                  visit in person and quote your reference below — the gym already
                  has your details.
                </p>
              </div>
            )}

            {/* What they were signing up for, and what it will cost at the
                counter. "at the gym" on the total is load-bearing: it is the
                difference between a price and an instruction to transfer money. */}
            <div className="order-summary">
              <div className="order-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                Your Request
              </div>
              <div className="order-row">
                <span className="label">Name</span>
                <span className="value">{leadInfo.memberName}</span>
              </div>
              <div className="order-row">
                <span className="label">Plan</span>
                <span className="value">{leadInfo.planName}</span>
              </div>
              <div className="order-row">
                <span className="label">Duration</span>
                <span className="value">{leadInfo.planDurationDays} days</span>
              </div>
              <div className="order-row">
                <span className="label">
                  {leadInfo.isRenewal ? "Renewal" : "New member"}
                </span>
                <span className="value">{leadInfo.reference}</span>
              </div>
              <div className="order-row total">
                <span className="label">Pay at the gym</span>
                <span className="value">
                  ₹{leadInfo.amount.toLocaleString("en-IN")}
                </span>
              </div>
            </div>

            {/* The reference is how the owner finds this exact request in a queue
                of them, so it gets its own badge rather than being buried in the
                summary above. */}
            <div className="ack-card">
              <p className="ack-text" style={{ marginBottom: 14 }}>
                Quote this when you speak to the gym
              </p>
              <div className="reference-badge">{leadInfo.reference}</div>
              <div className="ack-ref">
                <div className="copy-field">
                  <div className="copy-field-main">
                    <div className="copy-field-label">Your reference</div>
                    <div className="copy-field-value">{leadInfo.reference}</div>
                  </div>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyText(leadInfo.reference, "Reference")}
                  >
                    Copy
                  </button>
                </div>
              </div>

              {leadInfo.email && (
                <p className="ack-text" style={{ marginTop: 14 }}>
                  We&apos;ve sent a copy to <strong>{leadInfo.email}</strong>.
                </p>
              )}

              <a
                className="status-link"
                href={`/join/status?ref=${encodeURIComponent(leadInfo.reference)}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Check my status
              </a>
            </div>

            <button type="button" className="pay-startover" onClick={resetAll}>
              Start a new request
            </button>
          </div>
        )}

        {/* ==================================================================
            STEP 5 — PAID AND ACTIVE

            Only reachable from the gateway's success handler, i.e. money has
            actually been captured and verified server-side. The Gym ID is the
            one thing on this screen that matters: it is what they need to renew,
            to sign in at the counter, and to prove who they are — so it is
            rendered here, copyable, rather than living only in an email that may
            never arrive (the sending domain isn't verified yet, and the address
            is optional in the first place).
            ================================================================== */}
        {step === 5 && paidInfo && (
          <div>
            <div className="ack-card">
              <div className="ack-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="ack-title">
                {paidInfo.isRenewal ? "Renewed — you're all set! 💪" : "You're in! 💪"}
              </div>
              <p className="ack-text">
                Payment received{paidInfo.amount ? ` — ₹${paidInfo.amount.toLocaleString("en-IN")}` : ""}
                {paidInfo.branchName ? ` at ${paidInfo.branchName}` : ""}. Your
                membership is active right now, nothing else to do.
              </p>

              {/* gymId can be 0 on the idempotent replay path (a double-submitted
                  callback for a join whose member row we can't re-read). Showing
                  "#0" would be worse than saying so. */}
              {paidInfo.gymId > 0 ? (
                <>
                  <p className="ack-text" style={{ marginBottom: 14, marginTop: 18 }}>
                    <strong>Save your Gym ID.</strong> You&apos;ll need it every time
                    you renew.
                  </p>
                  <div className="reference-badge">#{paidInfo.gymId}</div>
                  <div className="ack-ref">
                    <div className="copy-field">
                      <div className="copy-field-main">
                        <div className="copy-field-label">Your Gym ID</div>
                        <div className="copy-field-value">#{paidInfo.gymId}</div>
                      </div>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => copyText(String(paidInfo.gymId), "Gym ID")}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="ack-text" style={{ marginTop: 18 }}>
                  This payment was already processed. Ask the gym for your Gym ID
                  when you next visit — your membership is active either way.
                </p>
              )}

              {/* Whether they have it in writing, or whether this screen is the
                  only copy. Two different instructions, so say which one applies
                  rather than a hopeful "check your email". */}
              <p className="ack-text" style={{ marginTop: 14 }}>
                {paidInfo.emailedTo ? (
                  <>
                    A receipt with your Gym ID is on its way to{" "}
                    <strong>{paidInfo.emailedTo}</strong>.
                  </>
                ) : (
                  <>
                    <strong>This screen is your only copy</strong> — take a
                    screenshot before you close it. The gym has your details and
                    can look your Gym ID up any time.
                  </>
                )}
              </p>
            </div>

            <div className="order-summary">
              <div className="order-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Membership
              </div>
              <div className="order-row">
                <span className="label">Name</span>
                <span className="value">{paidInfo.memberName}</span>
              </div>
              {paidInfo.planName && (
                <div className="order-row">
                  <span className="label">Plan</span>
                  <span className="value">{paidInfo.planName}</span>
                </div>
              )}
              {paidInfo.expiry && (
                <div className="order-row">
                  <span className="label">Valid till</span>
                  <span className="value">{paidInfo.expiry}</span>
                </div>
              )}
              <div className="order-row total">
                <span className="label">Paid</span>
                <span className="value">
                  ₹{paidInfo.amount.toLocaleString("en-IN")}
                </span>
              </div>
            </div>

            <button type="button" className="pay-startover" onClick={resetAll}>
              Join another membership
            </button>
          </div>
        )}
      </div>
    </>
  );
}
