"use client";

import { useState, useEffect, useRef } from "react";
import Script from "next/script";
import toast from "react-hot-toast";
import {
  createOnlineJoinOrder,
  verifyOnlinePayment,
  lookupMemberSecure,
  getPublicPlansForBranch,
  createManualJoinRequest,
  submitManualPaymentClaim,
} from "@/app/actions/payments";
import { buildWhatsAppLink } from "@/lib/whatsapp";

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

// Everything the pay-by-UPI + acknowledgement screens need, returned by
// createManualJoinRequest.
type PayInfo = {
  joinId: number;
  reference: string;
  amount: number;
  planName: string;
  planDurationDays: number;
  branchName: string;
  branchPhone: string | null;
  upiConfigured: boolean;
  upiId: string | null;
  payeeName: string;
  upiString: string | null;
  qrDataUrl: string | null;
  email: string | null;
  isRenewal: boolean;
};

export default function JoinPlansClient({
  initialBranches,
  paymentMode = "manual",
}: {
  initialBranches: Branch[];
  paymentMode?: "manual" | "razorpay";
}) {
  // Steps 1–3 are the funnel (branch → plan → details). 4 = pay by UPI,
  // 5 = acknowledgement. Steps 4/5 only ever show in manual mode; the Razorpay
  // path opens the gateway overlay from step 3 and never advances the step.
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

  // Manual UPI flow state.
  const [payInfo, setPayInfo] = useState<PayInfo | null>(null);
  const [utr, setUtr] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);

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

  // Full reset back to the start — used by "start a new request" on the pay and
  // acknowledgement screens.
  function resetAll() {
    setSelectedBranch(null);
    setSelectedPlan(null);
    setPlans([]);
    setVerified(null);
    setMemberType("new");
    setSearchGymId("");
    setSearchPhone("");
    setPayInfo(null);
    setUtr("");
    setAlreadyConfirmed(false);
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

  // Pre-filled WhatsApp message the member sends the owner to nudge a
  // confirmation. Only rendered when the branch has a phone number.
  function ownerWhatsAppLink(info: PayInfo): string {
    const msg =
      `Hi Brothers Gym! I've just paid ₹${info.amount} for the ${info.planName} plan` +
      `${info.branchName ? ` at ${info.branchName}` : ""} via UPI.\n\n` +
      `Reference: ${info.reference}\n\n` +
      `Please confirm my membership when you get a moment. Thank you! 🙏`;
    return buildWhatsAppLink(info.branchPhone || "", msg);
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

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);
    formData.set("planCode", selectedPlan.code);
    formData.set("joinType", memberType);
    formData.set("branchId", String(selectedBranch.id));
    formData.set("consentToHealthData", "true");

    if (memberType === "renewal" && verified) {
      formData.set("existingMemberId", String(verified.id));
    }

    // ===== MANUAL UPI FLOW (default) =====
    // Create the pending request, then move to the pay-by-UPI screen. No
    // external gateway, no script — the member pays out of band and the owner
    // confirms.
    if (paymentMode === "manual") {
      setLoading(true);
      const res = await createManualJoinRequest(formData);
      setLoading(false);

      if ("error" in res) {
        const msg = res.error || "Could not start the payment step.";
        toast.error(msg);
        setFormError(msg);
        return;
      }

      setPayInfo({
        joinId: res.joinId,
        reference: res.reference,
        amount: res.amount,
        planName: res.planName,
        planDurationDays: res.planDurationDays,
        branchName: res.branchName,
        branchPhone: res.branchPhone,
        upiConfigured: res.upiConfigured,
        upiId: res.upiId,
        payeeName: res.payeeName,
        upiString: res.upiString,
        qrDataUrl: res.qrDataUrl,
        email: res.email,
        isRenewal: res.isRenewal,
      });
      setUtr("");
      setAlreadyConfirmed(false);
      goToStep(4);
      return;
    }

    // ===== RAZORPAY FLOW (parked; PAYMENT_MODE=razorpay) =====
    setLoading(true);
    const order = await createOnlineJoinOrder(formData);
    setLoading(false);

    if (order.error || !order.orderId) {
      toast.error(order.error || "Could not start payment");
      setFormError(order.error || "Could not start payment");
      return;
    }

    const rzp = new window.Razorpay({
      key: order.key,
      amount: order.amount,
      currency: order.currency,
      name: `Brothers Gym - ${order.branchName}`,
      description: order.planName,
      order_id: order.orderId,
      prefill: {
        name: order.customer?.name,
        email: order.customer?.email,
        contact: order.customer?.contact,
      },
      theme: { color: "#F5A623" },
      handler: async function (response: any) {
        const result = await verifyOnlinePayment({
          joinId: order.joinId!,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });

        if (result.error) {
          toast.error(result.error);
          return;
        }

        const message = encodeURIComponent(
          `🏋️ *Brothers Gym - Membership Confirmed* 🏋️\n\n` +
            `Hi ${result.memberName},\n\n` +
            `Your payment was successful!\n\n` +
            `📍 *Branch:* ${selectedBranch.name}\n` +
            `📌 *Gym ID:* #${result.gymId}\n` +
            `📌 *Plan:* ${result.planName}\n` +
            `📌 *Amount Paid:* ₹${result.amount}\n` +
            `📌 *Valid Till:* ${result.expiry}\n\n` +
            `Thank you for choosing Brothers Gym!\n` +
            `See you at the gym! 💪`
        );
        const waNumber = result.contactNumber?.replace(/\D/g, "") || "";
        const waLink = `https://wa.me/91${waNumber}?text=${message}`;

        toast.success(`Payment successful! Gym ID #${result.gymId}`);

        const openWhatsApp = window.confirm(
          `✅ Welcome to Brothers Gym!\n\n` +
            `Branch: ${selectedBranch.name}\n` +
            `Gym ID: #${result.gymId}\n` +
            `Plan: ${result.planName}\n` +
            `Valid till: ${result.expiry}\n` +
            `Amount: ₹${result.amount}\n\n` +
            `Click OK to open WhatsApp for your receipt.`
        );
        if (openWhatsApp) window.open(waLink, "_blank");
      },
    });

    rzp.open();
  }

  async function handleClaim() {
    if (!payInfo) return;
    setClaimLoading(true);
    const res = await submitManualPaymentClaim({
      joinId: payInfo.joinId,
      upiReference: utr.trim() || undefined,
    });
    setClaimLoading(false);

    if ("error" in res) {
      toast.error(res.error || "Could not record your payment. Please try again.");
      return;
    }

    setAlreadyConfirmed("alreadyConfirmed" in res && res.alreadyConfirmed === true);
    goToStep(5);
  }

  const renewalBlocked = memberType === "renewal" && !verified;

  return (
    <>
      {/* The gateway script and its external connection are only needed for the
          parked Razorpay path; manual mode ships no third-party JS. */}
      {paymentMode === "razorpay" && (
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
            {paymentMode === "razorpay"
              ? "Pick your preferred branch and plan. Pay securely via UPI, Cards or Netbanking."
              : "Pick your preferred branch and plan. Pay by UPI — your membership is confirmed once the gym receives it."}
          </p>
          <div className="payment-icons">
            <div className="payment-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
              UPI
            </div>
            {paymentMode === "razorpay" && (
              <>
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
              </>
            )}
          </div>
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
                {paymentMode === "razorpay" ? (
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
                        <p className="trust-title">Pay by UPI</p>
                        <p className="trust-sub">Any UPI app</p>
                      </div>
                    </div>
                    <div className="trust-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                      <div>
                        <p className="trust-title">Owner Confirmed</p>
                        <p className="trust-sub">Real human check</p>
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
                disabled={loading || !consentChecked}
              >
                {loading ? (
                  <>
                    <svg
                      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                    {paymentMode === "razorpay" ? "Processing Payment..." : "Setting up payment..."}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="4" width="22" height="16" rx="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    {paymentMode === "razorpay" ? "Pay & Join Now" : "Continue to Payment"}
                  </>
                )}
              </button>

              <div className="secure-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                {paymentMode === "razorpay"
                  ? "Your payment is processed by Razorpay. We never see or store card/UPI details."
                  : "You pay the gym's UPI directly from your own app. We never see or store your UPI PIN or bank details."}
              </div>
            </form>
          </div>
        )}

        {/* STEP 4: PAY BY UPI (manual mode) */}
        {step === 4 && payInfo && (
          <div>
            <div className="selected-branch-banner">
              <div className="selected-branch-info">
                <div className="branch-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                </div>
                <div>
                  <div className="selected-branch-label">Almost done — pay to confirm</div>
                  <div className="selected-branch-name">
                    {payInfo.branchName || "Brothers Gym"}
                  </div>
                </div>
              </div>
            </div>

            {/* Payment summary */}
            <div className="order-summary">
              <div className="order-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                Payment Summary
              </div>
              <div className="order-row">
                <span className="label">Plan</span>
                <span className="value">{payInfo.planName}</span>
              </div>
              <div className="order-row">
                <span className="label">Duration</span>
                <span className="value">{payInfo.planDurationDays} days</span>
              </div>
              <div className="order-row">
                <span className="label">{payInfo.isRenewal ? "Renewal" : "New member"}</span>
                <span className="value">{payInfo.reference}</span>
              </div>
              <div className="order-row total">
                <span className="label">Amount to Pay</span>
                <span className="value">₹{payInfo.amount.toLocaleString("en-IN")}</span>
              </div>
            </div>

            {payInfo.upiConfigured ? (
              <div className="pay-upi-card">
                <div className="order-title" style={{ justifyContent: "center" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <line x1="14" y1="14" x2="14" y2="21" />
                    <line x1="18" y1="14" x2="21" y2="14" />
                    <line x1="18" y1="18" x2="21" y2="18" />
                    <line x1="18" y1="21" x2="21" y2="21" />
                  </svg>
                  Pay ₹{payInfo.amount.toLocaleString("en-IN")} by UPI
                </div>
                <p className="section-subtitle" style={{ textAlign: "center" }}>
                  On your phone, tap the button below to open your UPI app. On a
                  computer, scan the QR with any UPI app (GPay, PhonePe, Paytm…).
                  The amount is already filled in.
                </p>

                {payInfo.qrDataUrl && (
                  <div className="pay-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={payInfo.qrDataUrl}
                      alt={`UPI QR to pay ₹${payInfo.amount} to ${payInfo.payeeName}`}
                      width={240}
                      height={240}
                    />
                  </div>
                )}

                {payInfo.upiString && (
                  <a className="submit-btn" href={payInfo.upiString}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12" y2="18" />
                    </svg>
                    Open in UPI app
                  </a>
                )}

                {payInfo.upiId && (
                  <div className="copy-field">
                    <div className="copy-field-main">
                      <div className="copy-field-label">
                        UPI ID{payInfo.payeeName ? ` — ${payInfo.payeeName}` : ""}
                      </div>
                      <div className="copy-field-value">{payInfo.upiId}</div>
                    </div>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyText(payInfo.upiId!, "UPI ID")}
                    >
                      Copy
                    </button>
                  </div>
                )}

                <div className="copy-field">
                  <div className="copy-field-main">
                    <div className="copy-field-label">Your reference — keep this</div>
                    <div className="copy-field-value">{payInfo.reference}</div>
                  </div>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyText(payInfo.reference, "Reference")}
                  >
                    Copy
                  </button>
                </div>

                <div className="pay-divider">
                  <span>After you&apos;ve paid</span>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="utr-input">
                    UPI Reference / UTR number <span className="optional">(optional)</span>
                  </label>
                  <input
                    id="utr-input"
                    type="text"
                    className="form-input"
                    placeholder="12-digit number shown in your UPI app"
                    value={utr}
                    onChange={(e) => setUtr(e.target.value)}
                    inputMode="numeric"
                    maxLength={32}
                  />
                </div>

                <button
                  type="button"
                  className="submit-btn"
                  onClick={handleClaim}
                  disabled={claimLoading}
                >
                  {claimLoading ? (
                    <>
                      <svg
                        width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        style={{ animation: "spin 1s linear infinite" }}
                      >
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      I&apos;ve paid
                    </>
                  )}
                </button>
                <p className="secure-note" style={{ marginTop: 12 }}>
                  The UTR is optional — you can skip it. The gym confirms from
                  their own UPI record.
                </p>
              </div>
            ) : (
              <div className="pay-not-configured">
                <strong>Online payment isn&apos;t set up for this branch yet.</strong>
                <p>
                  Please call or WhatsApp the gym to pay and activate your
                  membership. Keep this reference handy:
                </p>
                <div className="reference-badge">{payInfo.reference}</div>
              </div>
            )}

            {/* Ask the owner */}
            {payInfo.branchPhone && (
              <div className="owner-actions">
                <a className="owner-btn" href={`tel:${payInfo.branchPhone}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  <span className="owner-btn-label">
                    Call<span className="btn-more"> the gym</span>
                  </span>
                </a>
                <a
                  className="owner-btn whatsapp"
                  href={ownerWhatsAppLink(payInfo)}
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
            )}

            <button type="button" className="pay-startover" onClick={resetAll}>
              Start a new request
            </button>
          </div>
        )}

        {/* STEP 5: ACKNOWLEDGEMENT (manual mode) */}
        {step === 5 && payInfo && (
          <div>
            <div className="ack-card">
              <div className="ack-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="ack-title">
                {alreadyConfirmed ? "You're all set! 🎉" : "Thanks — we've got it! 💪"}
              </div>
              <p className="ack-text">
                {alreadyConfirmed
                  ? "Your membership is already confirmed. Check your status below for your Gym ID and validity."
                  : "We've recorded your payment and notified the gym. Your Gym ID activates as soon as the owner confirms your payment — usually within a few hours."}
              </p>

              <div className="copy-field ack-ref">
                <div className="copy-field-main">
                  <div className="copy-field-label">Your reference</div>
                  <div className="copy-field-value">{payInfo.reference}</div>
                </div>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyText(payInfo.reference, "Reference")}
                >
                  Copy
                </button>
              </div>

              {payInfo.email && !alreadyConfirmed && (
                <p className="ack-text" style={{ fontSize: 13 }}>
                  We&apos;ll email your confirmation to <strong>{payInfo.email}</strong>{" "}
                  once it&apos;s done.
                </p>
              )}

              <a
                className="status-link"
                href={`/join/status?ref=${encodeURIComponent(payInfo.reference)}`}
              >
                Check my status
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </a>
            </div>

            {payInfo.branchPhone && (
              <div className="owner-actions">
                <a className="owner-btn" href={`tel:${payInfo.branchPhone}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  <span className="owner-btn-label">
                    Call<span className="btn-more"> the gym</span>
                  </span>
                </a>
                <a
                  className="owner-btn whatsapp"
                  href={ownerWhatsAppLink(payInfo)}
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
            )}

            <button type="button" className="pay-startover" onClick={resetAll}>
              Join another membership
            </button>
          </div>
        )}
      </div>
    </>
  );
}
