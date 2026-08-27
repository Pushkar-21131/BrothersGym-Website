"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { getJoinStatus } from "@/app/actions/payments";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { formatDayIST } from "@/lib/manual-join";

type StatusResult = {
  status: string;
  reference: string;
  memberName: string;
  amount: number;
  branchName: string;
  branchPhone: string | null;
  gymId: number | null;
  expiry: string | null;
  claimedAt: string | null;
};

// Per-status presentation: heading, one-line explanation, and a colour accent.
const STATUS_COPY: Record<
  string,
  { title: string; text: string; tone: "wait" | "good" | "bad" }
> = {
  pending: {
    title: "Waiting for your payment",
    text: "We haven't recorded a payment for this request yet. If you've already paid, tap “I've paid” on the join page or message the gym below.",
    tone: "wait",
  },
  claimed: {
    title: "Payment received — confirming",
    text: "Thanks! We've noted your payment and the gym is confirming it. Your Gym ID activates as soon as the owner verifies it — usually within a few hours.",
    tone: "wait",
  },
  paid: {
    title: "Membership confirmed 🎉",
    text: "Your payment is confirmed and your membership is active. Show your Gym ID at the counter.",
    tone: "good",
  },
  rejected: {
    title: "This request was cancelled",
    text: "This join request is no longer active. If you believe this is a mistake or you've already paid, please contact the gym.",
    tone: "bad",
  },
  failed: {
    title: "Something went wrong",
    text: "This request didn't complete. Please start a new join, or contact the gym for help.",
    tone: "bad",
  },
};

export default function StatusClient({
  initialRef = "",
}: {
  initialRef?: string;
}) {
  const [reference, setReference] = useState(initialRef);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);

  async function handleCheck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reference.trim()) return toast.error("Enter your reference code");
    if (!phone.trim() || phone.trim().length < 10)
      return toast.error("Enter your registered 10-digit phone number");

    setLoading(true);
    const res = await getJoinStatus({
      reference: reference.trim(),
      phone: phone.trim(),
    });
    setLoading(false);

    if ("error" in res) {
      toast.error(res.error || "Could not look up that reference.");
      setResult(null);
      return;
    }

    setResult({
      status: res.status,
      reference: res.reference,
      memberName: res.memberName,
      amount: res.amount,
      branchName: res.branchName,
      branchPhone: res.branchPhone,
      gymId: res.gymId,
      expiry: res.expiry,
      claimedAt: res.claimedAt,
    });
  }

  const copy = result ? STATUS_COPY[result.status] ?? STATUS_COPY.pending : null;

  function ownerWhatsAppLink(r: StatusResult): string {
    const msg =
      `Hi Brothers Gym! I'm checking on my membership.\n\n` +
      `Reference: ${r.reference}\n` +
      `Name: ${r.memberName}\n\n` +
      `Could you please let me know the status? Thank you! 🙏`;
    return buildWhatsAppLink(r.branchPhone || "", msg);
  }

  return (
    <>
      <div className="bg-effects">
        <div className="bg-orb bg-orb-1"></div>
        <div className="bg-orb bg-orb-2"></div>
        <div className="bg-orb bg-orb-3"></div>
      </div>
      <div className="bg-grid"></div>

      <div className="join-container">
        <div className="join-header">
          <div className="header-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Brothers Gym — Membership Status
          </div>
          <h1>
            Check your <span className="highlight">join status</span>
          </h1>
          <p>
            Enter the reference code from your payment screen and your registered
            phone number to see where your membership stands.
          </p>
        </div>

        <form onSubmit={handleCheck}>
          <div className="form-card">
            <div className="form-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Your reference
            </div>
            <div className="form-grid">
              <div className="form-group full-width">
                <label className="form-label" htmlFor="status-ref">
                  Reference code <span className="required">*</span>
                </label>
                <input
                  id="status-ref"
                  type="text"
                  className="form-input"
                  placeholder="e.g. BG-NR-000123"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="form-group full-width">
                <label className="form-label" htmlFor="status-phone">
                  Registered phone <span className="required">*</span>
                </label>
                <input
                  id="status-phone"
                  type="tel"
                  className="form-input"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={10}
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? (
              <>
                <svg
                  width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                Checking…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Check status
              </>
            )}
          </button>
        </form>

        {result && copy && (
          <div
            className="ack-card"
            style={{
              marginTop: 24,
              borderColor:
                copy.tone === "good"
                  ? "rgba(16, 185, 129, 0.3)"
                  : copy.tone === "bad"
                    ? "rgba(239, 68, 68, 0.3)"
                    : "rgba(245, 166, 35, 0.3)",
            }}
          >
            <div
              className="ack-icon"
              style={{
                background:
                  copy.tone === "good"
                    ? "var(--success-glow)"
                    : copy.tone === "bad"
                      ? "rgba(239, 68, 68, 0.15)"
                      : "rgba(245, 166, 35, 0.12)",
                color:
                  copy.tone === "good"
                    ? "var(--success)"
                    : copy.tone === "bad"
                      ? "#ef4444"
                      : "var(--gold)",
              }}
            >
              {copy.tone === "good" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : copy.tone === "bad" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              )}
            </div>
            <div className="ack-title">{copy.title}</div>
            <p className="ack-text">{copy.text}</p>

            {result.status === "paid" && result.gymId ? (
              <div className="order-summary" style={{ textAlign: "left", marginTop: 16 }}>
                <div className="order-row">
                  <span className="label">Member</span>
                  <span className="value">{result.memberName}</span>
                </div>
                <div className="order-row">
                  <span className="label">Gym ID</span>
                  <span className="value">#{result.gymId}</span>
                </div>
                {result.expiry && (
                  <div className="order-row">
                    <span className="label">Valid till</span>
                    <span className="value">{formatDayIST(result.expiry)}</span>
                  </div>
                )}
                <div className="order-row">
                  <span className="label">Reference</span>
                  <span className="value">{result.reference}</span>
                </div>
              </div>
            ) : (
              <div className="copy-field ack-ref">
                <div className="copy-field-main">
                  <div className="copy-field-label">Reference</div>
                  <div className="copy-field-value">{result.reference}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {result && result.branchPhone && result.status !== "paid" && (
          <div className="owner-actions">
            <a className="owner-btn" href={`tel:${result.branchPhone}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
              </svg>
              Call the gym
            </a>
            <a
              className="owner-btn whatsapp"
              href={ownerWhatsAppLink(result)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.94 1.35-.5.05-1.13.24-3.66-.77-3.08-1.24-5.06-4.4-5.21-4.6-.15-.2-1.24-1.65-1.24-3.15s.79-2.24 1.07-2.54c.28-.3.61-.38.81-.38.2 0 .4 0 .58.01.19.01.44-.07.68.52.24.6.83 2.06.9 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.47.13.64-.08.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.71.81 2 .96.3.15.5.22.57.35.07.12.07.72-.17 1.4z" />
              </svg>
              WhatsApp the gym
            </a>
          </div>
        )}

        <div className="secure-note" style={{ marginTop: 20 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          Your details are only shown after your reference and phone number match.
        </div>
      </div>
    </>
  );
}
