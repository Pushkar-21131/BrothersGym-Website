"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { getJoinStatus, pollJoinStatus } from "@/app/actions/payments";
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
  hasProof: boolean;
};

/**
 * How often the page re-checks a request that's waiting on the owner, and how
 * long it keeps doing so.
 *
 * 8 seconds is fast enough that a confirmation appears while the member is still
 * looking at the page, and slow enough to stay far inside the poll endpoint's
 * budget (240 per 15 minutes per request — see pollJoinStatus). The 30-minute
 * ceiling is there so a tab left open overnight doesn't poll until the token
 * expires; past that the member gets an explicit refresh button.
 *
 * `pending` gets a slower interval, because what it is waiting for is different
 * in kind. A `claimed` row was waiting on the owner to glance at a screenshot he
 * already had — minutes away, and worth watching at 8s. A pending row is waiting
 * on a phone call that may not happen until tomorrow, so a fast poll spends 225
 * function invocations on an event that will almost certainly land long after the
 * tab is closed. 20s cuts that by ~60% and costs the member nothing they'd
 * notice.
 */
const POLL_INTERVAL_MS = 8000;
const POLL_INTERVAL_PENDING_MS = 20000;
const POLL_MAX_MS = 30 * 60 * 1000;

// Per-status presentation: heading, one-line explanation, and a colour accent.
const STATUS_COPY: Record<
  string,
  { title: string; text: string; tone: "wait" | "good" | "bad" }
> = {
  pending: {
    // This used to say "we haven't received a payment screenshot yet" and tell
    // them to go back and attach one. There is nothing to attach any more, and
    // nothing was charged — so the copy's job is to remove the fear that money
    // has gone somewhere and to say what actually happens next.
    title: "We have your details",
    text: "Nothing has been charged. Your details are with the gym and they'll call you to take the payment — or you can walk in and pay at the counter. Your Gym ID is issued the moment they do.",
    tone: "wait",
  },
  claimed: {
    // LEGACY. Only reachable by rows created under the old screenshot flow;
    // nothing sets this status now. Left accurate for those rows rather than
    // rewritten, because for them it is still exactly what is happening.
    title: "Under verification",
    text: "Your payment screenshot is with the gym. The owner checks it against their own UPI record and your Gym ID is issued the moment he confirms — usually within a few hours. You can leave this page open; it updates by itself.",
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

/**
 * Statuses that can still change on their own, and are therefore worth polling.
 *
 * `pending` is in here now and wasn't before. Under the old flow a pending row
 * was waiting on the *member* to attach a screenshot, so polling it was pointless
 * — nothing would move until they acted. Now a pending row is waiting on the
 * OWNER to take the money and press confirm, which is exactly the kind of change
 * the member wants to watch arrive.
 */
const LIVE_STATUSES = new Set(["pending", "claimed"]);

export default function StatusClient({
  initialRef = "",
}: {
  initialRef?: string;
}) {
  const [reference, setReference] = useState(initialRef);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  // Signed, short-lived, and specific to this one request. Exchanged for the
  // reference+phone match below so the polling loop never re-sends either.
  const [pollToken, setPollToken] = useState("");
  const [pollStopped, setPollStopped] = useState(false);

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
      setPollToken("");
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
      hasProof: res.hasProof,
    });
    setPollToken(res.pollToken);
    setPollStopped(false);
  }

  const status = result?.status ?? null;

  /**
   * Re-check the request without the member touching anything.
   *
   * Kept in a callback so both the interval and the "check now" button run the
   * exact same path. It merges rather than replaces, because the poll response
   * deliberately carries only what can change — the member's name, amount and
   * branch are already on screen and there's no reason to send them again.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!pollToken) return;
    const res = await pollJoinStatus({ token: pollToken });

    if ("error" in res) {
      // A throttle or a blip resolves itself on the next tick; an expired token
      // never will, so stop and let the member re-look-up.
      if (res.error === "expired") {
        setPollToken("");
        setPollStopped(true);
      }
      return;
    }

    if (res.status === "paid" && res.gymId) {
      toast.success(`Confirmed! Your Gym ID is #${res.gymId} 🎉`);
    }

    setResult((prev) => {
      if (!prev) return prev;
      // Returning the same object lets React skip the re-render entirely, which
      // matters when this fires every 8 seconds and usually nothing has changed.
      if (
        prev.status === res.status &&
        prev.gymId === res.gymId &&
        prev.hasProof === res.hasProof
      ) {
        return prev;
      }
      return {
        ...prev,
        status: res.status,
        gymId: res.gymId ?? prev.gymId,
        expiry: res.expiry ?? prev.expiry,
        hasProof: res.hasProof,
      };
    });
  }, [pollToken]);

  /**
   * Live polling while — and only while — the request is actually waiting on the
   * owner.
   *
   * This is the whole point of the status page. Watching it flip to "confirmed"
   * by itself is what turns "did my money vanish?" into "the gym is on it", and
   * it costs nothing on a free tier. Terminal statuses stop the loop, so a
   * confirmed or cancelled request polls zero times.
   */
  useEffect(() => {
    if (!pollToken || !status || !LIVE_STATUSES.has(status) || pollStopped)
      return;

    const startedAt = Date.now();
    let stop = false;

    const tick = () => {
      if (stop) return;
      // A backgrounded tab is nobody's anxiety. Don't spend polls on it — the
      // visibility handler below catches up the moment it returns.
      if (document.hidden) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setPollStopped(true);
        return;
      }
      void refresh();
    };

    const id = setInterval(
      tick,
      status === "pending" ? POLL_INTERVAL_PENDING_MS : POLL_INTERVAL_MS
    );
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollToken, status, pollStopped, refresh]);

  const copy = result ? STATUS_COPY[result.status] ?? STATUS_COPY.pending : null;
  const isLive =
    Boolean(pollToken) &&
    Boolean(status) &&
    LIVE_STATUSES.has(status as string) &&
    !pollStopped;

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

            {/* Where the request actually is, in three steps.
                A single status line leaves people guessing whether anything has
                happened at all; seeing the first step already ticked is what
                makes the wait feel like progress rather than silence. Hidden for
                cancelled/failed requests, where a progress bar would be a lie.

                Step 1 used to be "Payment sent · Screenshot attached", which is
                now false on every new row: nothing is sent and nothing is
                attached. What is true, and worth confirming, is that their form
                arrived — so that is what it says. */}
            {copy.tone !== "bad" && (
              <ol className="verify-steps">
                {[
                  {
                    label: "Details received",
                    sub: "Your form is with the gym",
                    state: "done",
                  },
                  {
                    label:
                      status === "claimed" ? "Under verification" : "Payment",
                    sub:
                      status === "paid"
                        ? "Received by the gym"
                        : status === "claimed"
                          ? result.hasProof
                            ? "Screenshot with the gym"
                            : "The gym is checking its record"
                          : "Pay at the gym — cash or UPI",
                    state: status === "paid" ? "done" : "active",
                  },
                  {
                    label: "Gym ID issued",
                    sub: result.gymId ? `#${result.gymId}` : "Membership activated",
                    state: status === "paid" ? "done" : "todo",
                  },
                ].map((s) => (
                  <li key={s.label} className={`verify-step is-${s.state}`}>
                    <span className="verify-dot">
                      {s.state === "done" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="verify-step-body">
                      <span className="verify-step-label">{s.label}</span>
                      <span className="verify-step-sub">{s.sub}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {/* Live-update affordances, for any status that can still move on its
                own — which now includes `pending`, because the owner confirming a
                counter payment is exactly the change worth watching for. */}
            {status && LIVE_STATUSES.has(status) &&
              (isLive ? (
                <div className="live-badge" aria-live="polite">
                  <span className="live-dot" aria-hidden="true" />
                  Updating automatically — no need to refresh
                </div>
              ) : pollToken ? (
                <button
                  type="button"
                  className="live-refresh"
                  onClick={() => {
                    setPollStopped(false);
                    void refresh();
                  }}
                >
                  Check again now
                </button>
              ) : (
                <p className="ack-text" style={{ fontSize: 12.5, marginTop: 12 }}>
                  Live updates have paused. Press <strong>Check status</strong>{" "}
                  above to resume.
                </p>
              ))}

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
              <span className="owner-btn-label">
                Call<span className="btn-more"> the gym</span>
              </span>
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
              <span className="owner-btn-label">
                WhatsApp<span className="btn-more"> the gym</span>
              </span>
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
