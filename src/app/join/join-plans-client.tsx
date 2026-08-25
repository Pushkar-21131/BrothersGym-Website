"use client";

import { useState, useEffect, useRef } from "react";
import Script from "next/script";
import toast from "react-hot-toast";
import {
  createOnlineJoinOrder,
  verifyOnlinePayment,
  lookupMemberSecure,
  getPublicPlansForBranch,
} from "@/app/actions/payments";

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

export default function JoinPlansClient({
  initialBranches,
}: {
  initialBranches: Branch[];
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
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

  function goToStep(next: 1 | 2 | 3) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // The 350ms delay before advancing a step lets the selected card finish its
  // press animation. Held in a ref and cleared on unmount so it can't fire
  // setState after the user has left the page, and so double-tapping two cards
  // in quick succession doesn't queue two competing step changes.
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function goToStepAfterAnimation(next: 1 | 2 | 3) {
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

  async function handlePay(e: React.FormEvent<HTMLFormElement>) {
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

  const renewalBlocked = memberType === "renewal" && !verified;

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />

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
          <p>Pick your preferred branch and plan. Pay securely via UPI, Cards or Netbanking.</p>
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
        </div>

        {/* PROGRESS BAR */}
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
                Change branch
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
                Existing Member Renewal
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
                        <div className="plan-check">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        {badge && !isSelected && <div className="plan-badge">{badge}</div>}
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

            <form onSubmit={handlePay}>
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
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="4" width="22" height="16" rx="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    Pay & Join Now
                  </>
                )}
              </button>

              <div className="secure-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Your payment is processed by Razorpay. We never see or store card/UPI details.
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}