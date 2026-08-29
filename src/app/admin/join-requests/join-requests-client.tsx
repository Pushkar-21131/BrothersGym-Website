"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  Mail,
  MapPin,
  Hash,
  MessageCircle,
} from "lucide-react";
import {
  confirmManualJoinPayment,
  rejectJoinRequest,
} from "@/app/actions/join-requests";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export type JoinRequestRow = {
  id: number;
  name: string;
  email: string | null;
  contactNumber: string;
  address: string | null;
  planCode: string;
  amount: number;
  status: "pending" | "claimed" | "paid" | "rejected" | "failed";
  upiReference: string | null;
  reference: string;
  branchName: string;
  branchCode: string;
  branchPhone: string | null;
  gymId: number | null;
  expiryLabel: string | null;
  createdLabel: string | null;
  claimedLabel: string | null;
};

type Filter = "awaiting" | "paid" | "rejected" | "all";

/** "full_3m" → "Full Access · 3 Months". Falls back to the raw code. */
function planLabel(code: string): string {
  const tier = code.startsWith("no_cardio")
    ? "No Cardio"
    : code.startsWith("full")
      ? "Full Access"
      : null;
  if (!tier) return code;
  const m = code.match(/_(\d+)m$/);
  const months = m ? Number(m[1]) : null;
  const dur = months ? `${months} Month${months > 1 ? "s" : ""}` : "";
  return dur ? `${tier} · ${dur}` : tier;
}

/** WhatsApp link the owner taps to send a confirmed member their Gym ID. Mirrors
 *  the message the confirm action builds, for cards shown after a refresh. */
function paidWhatsAppLink(r: JoinRequestRow): string {
  const lines = [
    `Hi ${r.name}! 💪 Welcome to Brothers Gym — your membership is confirmed.`,
    ``,
    `Gym ID: ${r.gymId}`,
    r.planCode ? `Plan: ${planLabel(r.planCode)}` : "",
    r.expiryLabel ? `Valid until: ${r.expiryLabel}` : "",
    ``,
    `Show your Gym ID at the counter. See you at the gym!`,
    `- Brothers Gym`,
  ].filter(Boolean);
  return buildWhatsAppLink(r.contactNumber, lines.join("\n"));
}

const STATUS_TAG: Record<
  JoinRequestRow["status"],
  { label: string; cls: string }
> = {
  pending: { label: "Not paid yet", cls: "warn" },
  claimed: { label: "Says they paid", cls: "gold" },
  paid: { label: "Confirmed", cls: "ok" },
  rejected: { label: "Rejected", cls: "off" },
  failed: { label: "Failed", cls: "off" },
};

export default function JoinRequestsClient({
  initialRequests,
}: {
  initialRequests: JoinRequestRow[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("awaiting");
  // id → busy action, so only the pressed card's buttons spin.
  const [busy, setBusy] = useState<{ id: number; action: "confirm" | "reject" } | null>(
    null
  );
  // id → whatsapp link, revealed right after a successful confirm (before the
  // router.refresh() lands and re-renders the card as "paid").
  const [justConfirmed, setJustConfirmed] = useState<Record<number, string>>({});

  const counts = useMemo(() => {
    let awaiting = 0,
      paid = 0,
      rejected = 0;
    for (const r of initialRequests) {
      if (r.status === "pending" || r.status === "claimed") awaiting++;
      else if (r.status === "paid") paid++;
      else rejected++; // rejected + failed
    }
    return { awaiting, paid, rejected, all: initialRequests.length };
  }, [initialRequests]);

  const visible = useMemo(() => {
    return initialRequests.filter((r) => {
      if (filter === "all") return true;
      if (filter === "awaiting")
        return r.status === "pending" || r.status === "claimed";
      if (filter === "paid") return r.status === "paid";
      return r.status === "rejected" || r.status === "failed"; // "rejected" chip
    });
  }, [initialRequests, filter]);

  async function handleConfirm(r: JoinRequestRow) {
    const ok = window.confirm(
      `Confirm you've RECEIVED ₹${r.amount.toLocaleString("en-IN")} from ${r.name}?\n\n` +
        `Check your UPI/bank app first. This activates their membership and creates their Gym ID.`
    );
    if (!ok) return;

    setBusy({ id: r.id, action: "confirm" });
    const res = await confirmManualJoinPayment(r.id);
    setBusy(null);

    if ("error" in res) {
      toast.error(res.error || "Could not confirm the payment.");
      return;
    }

    toast.success(`Confirmed — Gym ID #${res.gymId} created for ${res.memberName}`);
    setJustConfirmed((m) => ({ ...m, [r.id]: res.whatsappLink }));
    router.refresh();
  }

  async function handleReject(r: JoinRequestRow) {
    const ok = window.confirm(
      `Reject the request from ${r.name} (${r.reference})?\n\n` +
        `No membership is created. You can't undo this from here.`
    );
    if (!ok) return;

    setBusy({ id: r.id, action: "reject" });
    const res = await rejectJoinRequest(r.id);
    setBusy(null);

    if ("error" in res) {
      toast.error(res.error || "Could not reject the request.");
      return;
    }

    toast.success("Request rejected");
    router.refresh();
  }

  return (
    <div className="adm-pagebody">
      <div className="adm-chips">
        <button
          type="button"
          className={`adm-chip${filter === "awaiting" ? " active" : ""}`}
          onClick={() => setFilter("awaiting")}
        >
          Awaiting{counts.awaiting > 0 ? ` (${counts.awaiting})` : ""}
        </button>
        <button
          type="button"
          className={`adm-chip${filter === "paid" ? " active" : ""}`}
          onClick={() => setFilter("paid")}
        >
          Confirmed{counts.paid > 0 ? ` (${counts.paid})` : ""}
        </button>
        <button
          type="button"
          className={`adm-chip${filter === "rejected" ? " active" : ""}`}
          onClick={() => setFilter("rejected")}
        >
          Rejected{counts.rejected > 0 ? ` (${counts.rejected})` : ""}
        </button>
        <button
          type="button"
          className={`adm-chip${filter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All{counts.all > 0 ? ` (${counts.all})` : ""}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <Inbox size={22} />
          </div>
          <p className="adm-empty-title">
            {filter === "awaiting"
              ? "No requests awaiting confirmation"
              : "Nothing here"}
          </p>
          <p className="adm-empty-text">
            {filter === "awaiting"
              ? "When someone joins online and pays by UPI, their request shows up here for you to confirm."
              : "Try a different filter above."}
          </p>
        </div>
      ) : (
        <div className="adm-list">
          {visible.map((r) => {
            const tag = STATUS_TAG[r.status];
            const isAwaiting = r.status === "pending" || r.status === "claimed";
            const rowBusy = busy?.id === r.id;
            const waLink = justConfirmed[r.id];

            return (
              <article key={r.id} className="adm-rec">
                <div className="adm-rec-top">
                  <div
                    className={`adm-rec-ava${
                      r.status === "paid"
                        ? " ok"
                        : r.status === "rejected" || r.status === "failed"
                          ? " bad"
                          : ""
                    }`}
                    style={
                      isAwaiting ? { color: "var(--gold)" } : undefined
                    }
                  >
                    {r.status === "paid" ? (
                      <CheckCircle2 size={17} />
                    ) : r.status === "rejected" || r.status === "failed" ? (
                      <XCircle size={17} />
                    ) : (
                      <Clock size={17} />
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="adm-rec-name">{r.name}</div>
                    <div className="adm-rec-tags">
                      <span className={`adm-tag ${tag.cls}`}>{tag.label}</span>
                      <span className="adm-tag muted">{r.reference}</span>
                      <span className="adm-tag gold">{r.branchCode}</span>
                    </div>
                  </div>

                  <div className="adm-rec-amt">
                    ₹{r.amount.toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="adm-rec-grid">
                  <div>
                    <div className="adm-rec-k">Plan</div>
                    <div className="adm-rec-v" style={{ whiteSpace: "normal" }}>
                      {planLabel(r.planCode)}
                    </div>
                  </div>

                  <div>
                    <div className="adm-rec-k">Phone</div>
                    <div className="adm-rec-v">
                      <a href={`tel:${r.contactNumber}`} className="adm-link">
                        <Phone size={11} /> {r.contactNumber}
                      </a>
                    </div>
                  </div>

                  {r.email && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Email</div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
                      >
                        <a href={`mailto:${r.email}`} className="adm-link">
                          <Mail size={11} /> {r.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {r.address && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">
                        <MapPin size={9} style={{ display: "inline", marginRight: 3 }} />
                        Address
                      </div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                      >
                        {r.address}
                      </div>
                    </div>
                  )}

                  {r.upiReference && (
                    <div>
                      <div className="adm-rec-k">
                        <Hash size={9} style={{ display: "inline", marginRight: 3 }} />
                        Member&apos;s UTR
                      </div>
                      <div className="adm-rec-v">{r.upiReference}</div>
                    </div>
                  )}

                  {r.status === "paid" && r.gymId != null && (
                    <>
                      <div>
                        <div className="adm-rec-k">Gym ID</div>
                        <div className="adm-rec-v">#{r.gymId}</div>
                      </div>
                      {r.expiryLabel && (
                        <div>
                          <div className="adm-rec-k">Valid till</div>
                          <div className="adm-rec-v">{r.expiryLabel}</div>
                        </div>
                      )}
                    </>
                  )}

                  <div>
                    <div className="adm-rec-k">
                      {r.status === "claimed" && r.claimedLabel
                        ? "Marked paid"
                        : "Requested"}
                    </div>
                    <div className="adm-rec-v">
                      {(r.status === "claimed" && r.claimedLabel) ||
                        r.createdLabel ||
                        "—"}
                    </div>
                  </div>
                </div>

                <div className="adm-rec-foot">
                  {isAwaiting && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleConfirm(r)}
                        className="adm-act green"
                        disabled={rowBusy}
                        aria-label={`Confirm payment from ${r.name}`}
                      >
                        <CheckCircle2 size={15} />
                        <span className="adm-act-label">
                          {rowBusy && busy?.action === "confirm"
                            ? "Confirming…"
                            : "Confirm payment"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(r)}
                        className="adm-act red"
                        disabled={rowBusy}
                        aria-label={`Reject request from ${r.name}`}
                      >
                        <XCircle size={15} />
                        <span className="adm-act-label">
                          {rowBusy && busy?.action === "reject"
                            ? "Rejecting…"
                            : "Reject"}
                        </span>
                      </button>
                    </>
                  )}

                  {/* Right after confirming, use the link the action returned. */}
                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="adm-act green"
                      aria-label={`WhatsApp the Gym ID to ${r.name}`}
                    >
                      <MessageCircle size={15} />
                      <span className="adm-act-label">Send Gym ID on WhatsApp</span>
                    </a>
                  )}

                  {/* Confirmed rows (e.g. after a refresh) rebuild the link. */}
                  {r.status === "paid" && !waLink && (
                    <a
                      href={paidWhatsAppLink(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="adm-act green"
                      aria-label={`WhatsApp the Gym ID to ${r.name}`}
                    >
                      <MessageCircle size={15} />
                      <span className="adm-act-label">Send Gym ID on WhatsApp</span>
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
