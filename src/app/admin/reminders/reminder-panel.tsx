"use client";

import { sendSMSReminder } from "@/app/actions/sms";
import { useMemo, useState } from "react";
import { MessageCircle, Send, Smartphone, BellRing } from "lucide-react";
import toast from "react-hot-toast";
import { istDateString } from "@/lib/utils";
import {
  buildWhatsAppLink,
  generateReminderMessage,
  generateSMSMessage,
  getSMSVariables,
  ReminderTemplateId,
} from "@/lib/whatsapp";

/**
 * The six columns this panel actually reads — exported so `reminders/page.tsx`
 * can annotate its query with it.
 *
 * The page used to call `db.select()` with no column list and pass the result
 * straight in. That compiled silently: a wider object is assignable to a
 * narrower type, so there was no cast to notice and no error to fix, while every
 * active member's address, email, father's name, emergency contact and
 * left-gym notes were serialised into the page for a module that asks for none
 * of them.
 */
export type Member = {
  id: number;
  gymId: number;
  name: string;
  contactNumber: string;
  feeAmount: number;
  membershipExpiry: string;
};

type ReminderPanelProps = {
  members: Member[];
  expiringMembers: Member[];
  role?: "owner" | "staff";
  canSendWhatsApp?: boolean;
  canSendSMS?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function ReminderPanel({
  members,
  expiringMembers,
  role,
  canSendWhatsApp = true,
  canSendSMS = false,
}: ReminderPanelProps) {
  const [mode, setMode] = useState<"expiring" | "all">("expiring");
  const [templateId, setTemplateId] =
    useState<ReminderTemplateId>("friendly");
  const [customNote, setCustomNote] = useState("");
  const [useCustomOnly, setUseCustomOnly] = useState(false);

  const [smsLoadingId, setSmsLoadingId] = useState<number | null>(null);
  const [bulkSmsLoading, setBulkSmsLoading] = useState(false);
  const [bulkSmsProgress, setBulkSmsProgress] = useState("");

  const list = mode === "expiring" ? expiringMembers : members;
  const canWA = canSendWhatsApp;
  const canSMS = canSendSMS;

  // ============================================
  // WHATSAPP MESSAGE HELPERS
  // ============================================
  const preview = useMemo(() => {
    const sample = list[0] || {
      name: "Member Name",
      gymId: 1234,
      membershipExpiry: "2026-01-01",
      feeAmount: 1500,
      contactNumber: "9999999999",
      id: 0,
    };

    if (useCustomOnly) {
      return customNote
        .replaceAll("{name}", sample.name)
        .replaceAll("{gymId}", String(sample.gymId))
        .replaceAll("{expiry}", sample.membershipExpiry)
        .replaceAll("{fee}", `₹${sample.feeAmount}`);
    }

    return generateReminderMessage(templateId, {
      name: sample.name,
      gymId: sample.gymId,
      expiry: sample.membershipExpiry,
      feeAmount: sample.feeAmount,
      customNote,
    });
  }, [list, templateId, customNote, useCustomOnly]);

  const smsPreview = useMemo(() => {
    const sample = list[0] || {
      name: "Member Name",
      gymId: 1234,
      membershipExpiry: "2026-01-01",
      feeAmount: 1500,
    };

    return generateSMSMessage("reminder", {
      name: sample.name,
      gymId: sample.gymId,
      expiry: sample.membershipExpiry,
      feeAmount: sample.feeAmount,
    });
  }, [list]);

  function getWhatsAppMessage(member: Member) {
    if (useCustomOnly) {
      return customNote
        .replaceAll("{name}", member.name)
        .replaceAll("{gymId}", String(member.gymId))
        .replaceAll("{expiry}", member.membershipExpiry)
        .replaceAll("{fee}", `₹${member.feeAmount}`);
    }

    return generateReminderMessage(templateId, {
      name: member.name,
      gymId: member.gymId,
      expiry: member.membershipExpiry,
      feeAmount: member.feeAmount,
      customNote,
    });
  }

  // ============================================
  // WHATSAPP ACTIONS
  // ============================================
  function sendOneWhatsApp(member: Member) {
    const msg = getWhatsAppMessage(member);
    if (!msg.trim()) {
      toast.error("Message is empty.");
      return;
    }
    const url = buildWhatsAppLink(member.contactNumber, msg);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openAllWhatsApp() {
    if (list.length === 0) {
      toast.error("No members to remind.");
      return;
    }

    const confirmed = window.confirm(
      `Open WhatsApp for ${list.length} members?\n\nYour browser may block some popups.`
    );
    if (!confirmed) return;

    let opened = 0;
    for (const member of list) {
      const msg = getWhatsAppMessage(member);
      if (!msg.trim()) continue;
      const url = buildWhatsAppLink(member.contactNumber, msg);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win) opened++;
    }

    if (opened === 0) {
      toast.error("Popups blocked. Allow popups or send individually.");
    } else {
      toast.success(`Opened ${opened} WhatsApp tab(s).`);
    }
  }

  // ============================================
  // SMS ACTIONS (Owner only)
  // ============================================
  async function sendOneSMS(member: Member) {
    const smsText = generateSMSMessage("reminder", {
      name: member.name,
      gymId: member.gymId,
      expiry: member.membershipExpiry,
      feeAmount: member.feeAmount,
    });

    const confirmed = window.confirm(
      `Send this SMS to ${member.name} (${member.contactNumber})?\n\n"${smsText}"\n\nEstimated cost: ₹0.25`
    );
    if (!confirmed) return;

    setSmsLoadingId(member.id);

    try {
      const variables = getSMSVariables({
        name: member.name,
        gymId: member.gymId,
        expiry: member.membershipExpiry,
        feeAmount: member.feeAmount,
      });

      const result = await sendSMSReminder(
        member.id,
        member.contactNumber,
        variables,
        smsText
      );

      if (result.error) toast.error(result.error);
      else toast.success(`SMS sent to ${member.name}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send SMS.");
    } finally {
      setSmsLoadingId(null);
    }
  }

  async function sendAllSMS() {
    if (!canSMS) {
      toast.error("Only the owner can send SMS.");
      return;
    }
    if (list.length === 0) {
      toast.error("No members to remind.");
      return;
    }

    const estCost = (list.length * 0.25).toFixed(2);

    const confirmed = window.confirm(
      `Send SMS reminders to ${list.length} members?\n\nEstimated cost: ₹${estCost}\n\nMessages will be sent one by one.`
    );
    if (!confirmed) return;

    setBulkSmsLoading(true);
    let sent = 0;
    let failed = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        setBulkSmsProgress(`${i + 1}/${list.length}: ${m.name}`);

        const smsText = generateSMSMessage("reminder", {
          name: m.name,
          gymId: m.gymId,
          expiry: m.membershipExpiry,
          feeAmount: m.feeAmount,
        });

        const variables = getSMSVariables({
          name: m.name,
          gymId: m.gymId,
          expiry: m.membershipExpiry,
          feeAmount: m.feeAmount,
        });

        const r = await sendSMSReminder(
          m.id,
          m.contactNumber,
          variables,
          smsText
        );

        if (r.error) failed++;
        else sent++;

        await sleep(400);
      }

      if (sent > 0) toast.success(`${sent} SMS sent successfully.`);
      if (failed > 0) toast.error(`${failed} SMS failed.`);
    } finally {
      setBulkSmsLoading(false);
      setBulkSmsProgress("");
    }
  }

  // ============================================
  // RENDER
  // ============================================
  const today = istDateString();

  return (
    <div className="adm-pagebody">
      {/* Two columns on a laptop: write the message on the left, watch the list
          it will go to on the right. Below 900px .adm-dash is not a grid, so
          this collapses back to the phone order — compose, preview, then the
          list underneath. */}
      <div className="adm-dash">
        <div className="adm-dash-col">
      {/* Which list, as chips rather than a select — the count is the decision,
          and a native select hides it until tapped. */}
      <div className="adm-chips">
        <button
          type="button"
          onClick={() => setMode("expiring")}
          className={`adm-chip${mode === "expiring" ? " active" : ""}`}
          aria-pressed={mode === "expiring"}
        >
          Expiring / Expired <span>{expiringMembers.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setMode("all")}
          className={`adm-chip${mode === "all" ? " active" : ""}`}
          aria-pressed={mode === "all"}
        >
          All Members <span>{members.length}</span>
        </button>
      </div>

      <section className="adm-card">
        <div className="adm-field">
          <label className="adm-label" htmlFor="rm-template">
            WhatsApp template
          </label>
          <select
            id="rm-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as ReminderTemplateId)}
            disabled={useCustomOnly}
            className="adm-select"
          >
            <option value="friendly">Friendly English</option>
            <option value="urgent">Urgent Renewal</option>
            <option value="professional">Professional</option>
            <option value="hindi">Hindi Personalized</option>
          </select>
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor="rm-note">
            Personal message / note
          </label>
          <textarea
            id="rm-note"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            rows={3}
            placeholder="Example: Bhai {name}, kal gym aa jaana renewal ke liye 💪"
            className="adm-textarea"
          />
          <p className="adm-hint">
            Variables: {"{name}"} {"{gymId}"} {"{expiry}"} {"{fee}"}
          </p>
        </div>

        <label className="adm-switch">
          <span className="adm-switch-text">
            <span className="adm-switch-title">Send only my message</span>
            <span className="adm-switch-sub">
              Replaces the template — WhatsApp only
            </span>
          </span>
          <input
            type="checkbox"
            checked={useCustomOnly}
            onChange={(e) => setUseCustomOnly(e.target.checked)}
          />
          <span className="adm-switch-track" aria-hidden="true" />
        </label>
      </section>

      <h2 className="adm-h2">
        <MessageCircle size={14} /> WhatsApp Preview
      </h2>
      <pre className="adm-pre">{preview || "Write a message to preview…"}</pre>

      {canSMS && (
        <>
          <h2 className="adm-h2">
            <Smartphone size={14} /> SMS Preview · {smsPreview.length} chars ·{" "}
            {smsPreview.length <= 160 ? "1 segment" : "2+ segments"}
          </h2>
          <pre className="adm-pre sms">{smsPreview}</pre>
          <p className="adm-hint" style={{ marginTop: 6 }}>
            SMS uses the fixed DLT-approved template — the custom message above is
            ignored for SMS.
          </p>
        </>
      )}

      <div className="adm-bulk">
        {canWA && (
          <button
            type="button"
            onClick={openAllWhatsApp}
            disabled={bulkSmsLoading}
            className="adm-btn block"
            style={{
              background: "var(--green-soft)",
              borderColor: "rgba(34,197,94,.25)",
              color: "var(--green2)",
            }}
          >
            <MessageCircle size={16} />
            WhatsApp all {list.length}
          </button>
        )}

        {canSMS && (
          <button
            type="button"
            onClick={sendAllSMS}
            disabled={bulkSmsLoading || smsLoadingId !== null}
            className="adm-btn block"
            style={{
              background: "var(--blue-soft)",
              borderColor: "rgba(59,130,246,.25)",
              color: "var(--blue2)",
            }}
          >
            <Send size={16} />
            {bulkSmsLoading
              ? bulkSmsProgress || "Sending SMS…"
              : `SMS all (~₹${(list.length * 0.25).toFixed(2)})`}
          </button>
        )}
      </div>

      {!canSMS && role === "staff" && (
        <p className="adm-hint" style={{ marginTop: 9 }}>
          SMS reminders are not enabled for your account. Ask the owner to grant
          permission.
        </p>
      )}
        </div>

        <div className="adm-dash-col">
      <h2 className="adm-h2">
        <BellRing size={14} /> {list.length} in this list
      </h2>

      {list.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <BellRing size={22} />
          </div>
          <p className="adm-empty-title">Nobody to chase</p>
          <p className="adm-empty-text">
            No membership in this list needs a reminder right now.
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {list.map((m) => {
          const expired = m.membershipExpiry < today;
          return (
            <article key={m.id} className="adm-rec">
              <div className="adm-rec-top">
                <div className="adm-rec-ava">{m.name.charAt(0)}</div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-rec-id">#{m.gymId}</div>
                  <div className="adm-rec-name">{m.name}</div>
                  <div className="adm-rec-tags">
                    <span className={`adm-tag ${expired ? "off" : "warn"}`}>
                      {expired ? "Expired" : "Expiring"} {m.membershipExpiry}
                    </span>
                  </div>
                </div>

                <a href={`tel:${m.contactNumber}`} className="adm-link">
                  {m.contactNumber}
                </a>
              </div>

              <div className="adm-rec-foot">
                {canWA && (
                  <button
                    type="button"
                    onClick={() => sendOneWhatsApp(m)}
                    className="adm-act green"
                    aria-label={`WhatsApp ${m.name}`}
                  >
                    <MessageCircle size={15} />
                    <span className="adm-act-label">WhatsApp</span>
                  </button>
                )}

                {canSMS && (
                  <button
                    type="button"
                    onClick={() => sendOneSMS(m)}
                    disabled={smsLoadingId === m.id || bulkSmsLoading}
                    className="adm-act"
                    style={{ color: "var(--blue2)" }}
                    aria-label={`SMS ${m.name}`}
                  >
                    <Smartphone size={15} />
                    <span className="adm-act-label">
                      {smsLoadingId === m.id ? "Sending…" : "SMS ₹0.25"}
                    </span>
                  </button>
                )}
              </div>
            </article>
          );
        })}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
