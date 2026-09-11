"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  PhoneCall,
  Mail,
  MapPin,
  MessageCircle,
  ImageOff,
  ExternalLink,
  X,
  Download,
  Trash2,
} from "lucide-react";
import {
  confirmManualJoinPayment,
  rejectJoinRequest,
  deleteJoinProof,
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
  // Whether the gateway got as far as creating an order for this person, and
  // whether it actually captured the money. Together with `status` they separate
  // the four situations this queue now holds — see the comment on the select in
  // page.tsx. The short version:
  //   paidOnline          nothing to do, Razorpay already activated them
  //   !paidOnline, paid   the owner took the money in person and confirmed
  //   pending, hadOrder   they opened checkout and walked away
  //   pending, !hadOrder  they never got to a payment screen at all
  hadOrder: boolean;
  paidOnline: boolean;
  // LEGACY. Whether a payment screenshot is on file RIGHT NOW. Nothing uploads
  // these any more — the QR/screenshot flow is gone — but rows created while it
  // existed still carry images the owner may need to settle an old dispute, so
  // the viewer stays. The image itself is never sent with this page; see
  // /api/admin/join-proof/[id]. False once the image has been cleared, even
  // though proofUploadedLabel below still records that one was submitted.
  hasProof: boolean;
  proofUploadedLabel: string | null;
  // Days until the retention sweep clears this screenshot. Null means there is
  // nothing to warn about: a confirmed payment (kept until the owner deletes it),
  // no image left, or a deadline still too far off to be worth a line of text.
  proofExpiresInDays: number | null;
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

/**
 * WhatsApp link for chasing someone who filled the form and didn't pay.
 *
 * The tone matters more than usual here. This person is not a debtor — they
 * wanted to join and the payment either wasn't offered to them or didn't go
 * through, which is at least as likely to be our fault as theirs. So it opens by
 * thanking them and states the amount as information, not as a demand.
 *
 * It also names the plan and the reference, because the reply usually arrives
 * hours later on a phone with no context, and the owner would otherwise have to
 * come back to this page to work out who he was talking to.
 */
function leadWhatsAppLink(r: JoinRequestRow): string {
  const lines = [
    `Hi ${r.name}! 💪 Thanks for filling in the Brothers Gym join form${
      r.branchName ? ` for ${r.branchName}` : ""
    }.`,
    ``,
    r.planCode ? `Plan: ${planLabel(r.planCode)}` : "",
    `Amount: ₹${r.amount.toLocaleString("en-IN")}`,
    `Reference: ${r.reference}`,
    ``,
    `You can pay at the gym — cash or UPI — and we'll activate your membership` +
      ` and give you your Gym ID right away. When would you like to come in?`,
    `- Brothers Gym`,
  ].filter(Boolean);
  return buildWhatsAppLink(r.contactNumber, lines.join("\n"));
}

/**
 * Status → the label the owner reads.
 *
 * These are written from the owner's point of view, not the database's: what he
 * needs to know is whether money has arrived and whether he has to do something.
 * Hence "Needs a call" rather than "Pending" — the row is a task, and a status
 * word that doesn't say what the task is makes him open the card to find out.
 *
 * `claimed` is legacy only. It meant "the member tapped I've paid" in the deleted
 * screenshot flow; nothing writes it any more, but old rows still render.
 */
const STATUS_TAG: Record<
  JoinRequestRow["status"],
  { label: string; cls: string }
> = {
  pending: { label: "Needs a call", cls: "warn" },
  claimed: { label: "Says they paid", cls: "gold" },
  paid: { label: "Active", cls: "ok" },
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
  const [busy, setBusy] = useState<{
    id: number;
    action: "confirm" | "reject" | "delete-proof";
  } | null>(null);
  // id → whatsapp link, revealed right after a successful confirm (before the
  // router.refresh() lands and re-renders the card as "paid").
  const [justConfirmed, setJustConfirmed] = useState<Record<number, string>>({});
  // The request whose screenshot is open full-size. The owner has to actually
  // read an amount and a payee off it, and a 76px thumbnail can't carry that.
  const [zoom, setZoom] = useState<JoinRequestRow | null>(null);

  // Esc closes the viewer — it covers the screen, so there has to be a way out
  // that isn't hunting for the button.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

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
    // The wording carries the whole safeguard. Nothing in the system can see
    // money that changed hands at the counter, so this dialog exists to make the
    // owner state plainly that it did before a membership is created.
    //
    // The middle line is the part that earns its keep: it says how much was
    // charged online, which is nothing, in all three cases. The failure this
    // guards against is the owner assuming a row in this queue means a payment
    // already came in — it means the opposite.
    const ok = window.confirm(
      `Confirm you've RECEIVED ₹${r.amount.toLocaleString("en-IN")} from ${r.name}?\n\n` +
        (r.hasProof
          ? `There's an old payment screenshot on this request — check that the amount actually landed in your bank/UPI app before confirming.`
          : r.hadOrder
            ? `They opened the online payment and didn't finish it, so NOTHING was charged. Only confirm once you've taken the money yourself — cash, UPI or card at the gym.`
            : `NOTHING was charged online. Only confirm once you've taken the money yourself — cash, UPI or card at the gym.`) +
        `\n\nThis activates their membership and creates their Gym ID.`
    );
    if (!ok) return;

    setBusy({ id: r.id, action: "confirm" });
    const res = await confirmManualJoinPayment(r.id);
    setBusy(null);

    if ("error" in res) {
      toast.error(res.error || "Could not confirm the payment.");
      return;
    }

    // Naming the email address, or its absence, tells the owner whether the
    // WhatsApp button below is the member's only copy of their Gym ID. Members
    // are not required to give an email, so "no email" is normal, not a fault.
    toast.success(
      `Gym ID #${res.gymId} created for ${res.memberName}` +
        (res.emailedTo
          ? ` — emailed to ${res.emailedTo}`
          : ` — no email on file, send it on WhatsApp`),
      { duration: 6000 }
    );
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

  async function handleDeleteProof(r: JoinRequestRow) {
    // Pointing at Download is the whole job of this dialog. The delete is
    // irreversible and a copy on the owner's own device is the only thing that
    // survives it, so the escape route has to be named before they commit.
    const ok = window.confirm(
      `Delete ${r.name}'s payment screenshot from the database?\n\n` +
        `This frees up storage but cannot be undone — the image is gone for good.\n\n` +
        `If you might need it later, press Cancel and use Download first.`
    );
    if (!ok) return;

    setBusy({ id: r.id, action: "delete-proof" });
    const res = await deleteJoinProof(r.id);
    setBusy(null);

    if ("error" in res) {
      toast.error(res.error || "Could not delete the screenshot.");
      return;
    }

    toast.success("Screenshot deleted");
    // If the viewer happens to be open on the image we just deleted, close it —
    // leaving it up would show a broken image over the whole screen.
    setZoom((z) => (z?.id === r.id ? null : z));
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
          Follow up{counts.awaiting > 0 ? ` (${counts.awaiting})` : ""}
        </button>
        <button
          type="button"
          className={`adm-chip${filter === "paid" ? " active" : ""}`}
          onClick={() => setFilter("paid")}
        >
          Active{counts.paid > 0 ? ` (${counts.paid})` : ""}
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
            {filter === "awaiting" ? "Nobody to follow up" : "Nothing here"}
          </p>
          <p className="adm-empty-text">
            {filter === "awaiting"
              ? "Anyone who pays online is activated automatically and never appears here. This list is only for people who filled the form without paying — they show up for you to call."
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
                    ) : r.status === "claimed" ? (
                      // Legacy screenshot flow: they said they paid and the owner
                      // hasn't ruled on it. Genuinely "waiting", so a clock.
                      <Clock size={17} />
                    ) : (
                      // A phone, not a clock. This row isn't waiting on the
                      // system to do something — it's waiting on the owner to
                      // ring someone.
                      <PhoneCall size={17} />
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="adm-rec-name">{r.name}</div>
                    <div className="adm-rec-tags">
                      <span className={`adm-tag ${tag.cls}`}>{tag.label}</span>
                      {/* How the money arrived — or how far they got without it.
                          The status word can't carry this: "Active" covers both a
                          card payment that settled itself and cash the owner took
                          at the counter, and those are different facts when a
                          member later disputes one. */}
                      {r.paidOnline ? (
                        <span className="adm-tag ok">Paid online</span>
                      ) : r.status === "paid" ? (
                        <span className="adm-tag muted">Paid at gym</span>
                      ) : r.status === "pending" && r.hadOrder ? (
                        <span className="adm-tag muted">Left checkout</span>
                      ) : null}
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

                  {/* LEGACY EVIDENCE. Nothing uploads screenshots any more, so
                      this block only ever renders for rows created under the old
                      QR flow — which still need to be resolvable, and still need
                      their storage reclaimable. A thumbnail rather than the full
                      image so a 50-row list stays scrollable; tap to read it.

                      The gate is deliberately narrow: `hasProof` (an image is
                      there) or `proofUploadedLabel` (one was there and has since
                      been cleared — the audit trail outlives the image). It used
                      to also fire on status === "claimed" with a "No screenshot
                      attached — verify in your UPI app" fallback. That fallback is
                      gone: on a modern row it would appear on every card and
                      advise the owner to check a UPI app for money nobody sent. */}
                  {(r.hasProof || r.proofUploadedLabel) && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Payment screenshot</div>
                      {r.hasProof ? (
                        <>
                          <button
                            type="button"
                            className="adm-proof"
                            onClick={() => setZoom(r)}
                            aria-label={`View payment screenshot from ${r.name}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/admin/join-proof/${r.id}`}
                              alt={`Payment screenshot from ${r.name}`}
                              loading="lazy"
                            />
                            <span className="adm-proof-meta">
                              <span className="adm-proof-cta">Tap to view</span>
                              {r.proofUploadedLabel && (
                                <span className="adm-proof-time">
                                  Uploaded {r.proofUploadedLabel}
                                </span>
                              )}
                            </span>
                          </button>

                          <div className="adm-proof-acts">
                            {/* A plain link, not a fetch + blob: the route sets
                                Content-Disposition: attachment for ?download=1,
                                so the browser saves it straight to the phone or
                                laptop with a sensible filename. */}
                            <a
                              href={`/api/admin/join-proof/${r.id}?download=1`}
                              download
                              className="adm-proof-act"
                              aria-label={`Download the payment screenshot from ${r.name}`}
                            >
                              <Download size={13} />
                              Download
                            </a>
                            {/* Settled requests only — while one is still
                                awaiting a decision the screenshot is the thing
                                the decision is made on. */}
                            {(r.status === "paid" || r.status === "rejected") && (
                              <button
                                type="button"
                                className="adm-proof-act red"
                                onClick={() => handleDeleteProof(r)}
                                disabled={rowBusy}
                                aria-label={`Delete the payment screenshot from ${r.name}`}
                              >
                                <Trash2 size={13} />
                                {rowBusy && busy?.action === "delete-proof"
                                  ? "Deleting…"
                                  : "Delete from database"}
                              </button>
                            )}
                          </div>

                          {r.proofExpiresInDays !== null && (
                            <div className="adm-proof-ttl">
                              {r.proofExpiresInDays === 0
                                ? "Screenshot deletes automatically today — download it now if you want a copy."
                                : `Screenshot deletes automatically in ${
                                    r.proofExpiresInDays
                                  } day${
                                    r.proofExpiresInDays === 1 ? "" : "s"
                                  } — download it first if you want a copy.`}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="adm-proof-gone">
                          <ImageOff size={13} />
                          Submitted {r.proofUploadedLabel} · image no longer stored
                        </div>
                      )}
                    </div>
                  )}

                  {/* Why this row needs nothing, or what went wrong — one field,
                      four values, so the owner reads it in the same place every
                      time. Without it "Active" and "Needs a call" are the only
                      signals, and neither says whether money moved through the
                      gateway. */}
                  {r.paidOnline ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Payment</div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                      >
                        Paid online — the membership activated itself. Nothing here
                        for you to confirm.
                      </div>
                    </div>
                  ) : r.status === "paid" ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Payment</div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                      >
                        Taken at the gym and confirmed by you — not through the
                        online gateway.
                      </div>
                    </div>
                  ) : r.status === "pending" && r.hadOrder ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Payment</div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                      >
                        They opened the online payment and closed it without
                        finishing. Nothing was charged — worth asking whether they
                        still want to join.
                      </div>
                    </div>
                  ) : r.status === "pending" ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div className="adm-rec-k">Payment</div>
                      <div
                        className="adm-rec-v"
                        style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                      >
                        Never reached a payment screen. Nothing was charged — take
                        the money at the gym, then press Money received.
                      </div>
                    </div>
                  ) : null}

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
                      {/* Call and WhatsApp sit BEFORE Confirm on purpose: the
                          order is the workflow. Nobody in this queue has paid, so
                          reaching them comes first and confirming comes after the
                          money is in hand. Confirm sitting leftmost would invite a
                          tap that creates a membership nobody paid for.

                          Both are icon-only (.adm-act.icon → 38px square) so all
                          four actions still fit one phone row instead of wrapping
                          onto a second and making every card taller. */}
                      <a
                        href={`tel:${r.contactNumber}`}
                        className="adm-act icon"
                        title={`Call ${r.name}`}
                        aria-label={`Call ${r.name} on ${r.contactNumber}`}
                      >
                        <Phone size={15} />
                      </a>
                      <a
                        href={leadWhatsAppLink(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="adm-act icon"
                        title={`WhatsApp ${r.name}`}
                        aria-label={`WhatsApp ${r.name} about joining`}
                      >
                        <MessageCircle size={15} />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleConfirm(r)}
                        className="adm-act green"
                        disabled={rowBusy}
                        aria-label={`Confirm you have received payment from ${r.name}`}
                      >
                        <CheckCircle2 size={15} />
                        <span className="adm-act-label">
                          {rowBusy && busy?.action === "confirm"
                            ? "Confirming…"
                            : "Money received"}
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

                  {/* Already-active rows (after a refresh, or a gateway payment
                      that activated itself) rebuild the link. This is the only
                      action a gateway row ever offers, and it is the one that
                      matters: the member's Gym ID is otherwise only in an email
                      they may not have given us an address for. Gated on gymId
                      because a paid row whose member lookup came back empty would
                      otherwise send a message reading "Gym ID: null". */}
                  {r.status === "paid" && r.gymId != null && !waLink && (
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

      {/* Full-size screenshot viewer.
          The amount shown alongside is the amount we EXPECT — putting it next to
          the image means the owner is comparing two numbers on one screen instead
          of remembering one while scrolling to the other. */}
      {zoom && (
        <div
          className="adm-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Payment screenshot from ${zoom.name}`}
          onClick={() => setZoom(null)}
        >
          <div className="adm-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="adm-lightbox-bar">
              <div style={{ minWidth: 0 }}>
                <div className="adm-lightbox-name">{zoom.name}</div>
                <div className="adm-lightbox-sub">
                  {zoom.reference} · expecting{" "}
                  <strong>₹{zoom.amount.toLocaleString("en-IN")}</strong>
                </div>
              </div>
              <a
                href={`/api/admin/join-proof/${zoom.id}?download=1`}
                download
                className="adm-lightbox-btn"
                aria-label="Download the screenshot"
                title="Download"
              >
                <Download size={16} />
              </a>
              <a
                href={`/api/admin/join-proof/${zoom.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="adm-lightbox-btn"
                aria-label="Open the screenshot in a new tab"
                title="Open in a new tab"
              >
                <ExternalLink size={16} />
              </a>
              <button
                type="button"
                className="adm-lightbox-btn"
                onClick={() => setZoom(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/join-proof/${zoom.id}`}
              alt={`Payment screenshot from ${zoom.name}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
