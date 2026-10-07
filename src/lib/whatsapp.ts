// ============================================
// WHATSAPP HELPERS
// ============================================

export function normalizePhone(phone: string, countryCode = "91") {
  const digits = phone.replace(/\D/g, "");
  // Check length first: a valid 10-digit number that happens to start with the
  // country code (e.g. "9112345678") must still be prefixed, not passed through.
  if (digits.length === 10) return `${countryCode}${digits}`;
  if (digits.startsWith(countryCode)) return digits;
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string) {
  const country = process.env.NEXT_PUBLIC_WHATSAPP_COUNTRY_CODE || "91";
  const num = normalizePhone(phone, country);
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

/**
 * Whether there is a number worth opening a chat or dialling.
 *
 * An imported member can have no phone. Without this, buildWhatsAppLink("")
 * yields `wa.me/?text=…`, which opens WhatsApp with no recipient — the message
 * is never sent and nothing looks wrong — and `tel:` becomes a no-op.
 */
export function hasDialablePhone(phone: string | null | undefined): boolean {
  return (phone ?? "").replace(/\D/g, "").length >= 10;
}

// ============================================
// WHATSAPP TEMPLATES (long, expressive, emoji-friendly)
// ============================================

export type ReminderTemplateId = "friendly" | "urgent" | "professional" | "hindi";

export function generateReminderMessage(
  templateId: ReminderTemplateId,
  data: {
    name: string;
    gymId: number | string;
    expiry: string;
    feeAmount?: number;
    customNote?: string;
  }
) {
  const fee = data.feeAmount
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(data.feeAmount)
    : "";

  const templates: Record<ReminderTemplateId, string> = {
    friendly: `Hi ${data.name}! 👋

This is a friendly reminder from *Brothers Gym*.
Your membership (Gym ID #${data.gymId}) is expiring on *${data.expiry}*.

Please renew soon so your training stays uninterrupted.
${fee ? `Renewal amount: *${fee}*` : ""}

See you at the gym! 💪
- Brothers Gym Team`,

    urgent: `Hello ${data.name},

⚠️ Your Brothers Gym membership (ID #${data.gymId}) expires on *${data.expiry}*.

Please renew today to avoid interruption in gym access.
${fee ? `Amount due: *${fee}*` : ""}

Visit the gym or pay online to continue.
- Brothers Gym`,

    professional: `Dear ${data.name},

Greetings from Brothers Gym.
This is a membership renewal notice for Gym ID #${data.gymId}.

Expiry Date: ${data.expiry}
${fee ? `Fee: ${fee}` : ""}

Kindly complete renewal at your earliest convenience.
Thank you for training with us.

Regards,
Brothers Gym`,

    hindi: `नमस्ते ${data.name} जी 🙏

Brothers Gym की तरफ से रिमाइंडर:
आपकी मेंबरशिप (Gym ID #${data.gymId}) *${data.expiry}* को समाप्त हो रही है।

कृपया जल्दी रिन्यू करवाएं ताकि आपकी ट्रेनिंग जारी रहे।
${fee ? `रिन्यूअल राशि: *${fee}*` : ""}

धन्यवाद,
Brothers Gym Team 💪`,
  };

  const base = templates[templateId];
  if (data.customNote?.trim()) {
    return `${base}\n\nPersonal note:\n${data.customNote.trim()}`;
  }
  return base;
}

// ============================================
// ENQUIRY FOLLOW-UP TEMPLATES
// ============================================
// For people who asked about joining and haven't decided. Every one of these
// lands in an editable box before sending — the owner sends these personally.

export type EnquiryTemplateId = "gentle" | "join_now" | "hindi";

export function generateEnquiryMessage(
  templateId: EnquiryTemplateId,
  data: { name: string }
) {
  const templates: Record<EnquiryTemplateId, string> = {
    gentle: `Hi ${data.name}! 👋

This is Brothers Gym — you'd asked about joining. Just checking in to see if you're still thinking it over.

If you have any questions about the plans or the timings, just reply here. We'd be glad to have you train with us. 💪
- Brothers Gym Team`,

    join_now: `Hi ${data.name}!

Brothers Gym here, following up on your enquiry.

Are you ready to start your membership? Just reply yes and we'll get you set up. 💪
- Brothers Gym Team`,

    hindi: `नमस्ते ${data.name} जी 🙏

Brothers Gym की तरफ से। आप जॉइन करने के बारे में पूछने आए थे — क्या आप अभी भी सोच रहे हैं?

कोई भी सवाल हो तो यहीं मैसेज कर दीजिए। हमें आपके साथ ट्रेनिंग करने में खुशी होगी। 💪
- Brothers Gym Team`,
  };

  return templates[templateId];
}

// ============================================
// MEMBER UPDATE MESSAGE
// ============================================

/** One field the owner changed, in a form that reads as "old → new". */
export type MemberChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

/** "2026-11-04" → "4 Nov 2026". UTC, so the calendar day never slips. */
export function formatDateIn(iso: string) {
  const [y, m, d] = String(iso ?? "").split("-").map(Number);
  if (!y || !m || !d) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const PLAN_LABELS: Record<string, string> = {
  full: "Cardio",
  no_cardio: "Hardcore",
  offline: "Not recorded",
};

/**
 * The WhatsApp message sent after a member's details change, or — with no
 * changes — a summary of what the gym currently holds for them.
 *
 * `changes` empty is not an error: that is the standing "WhatsApp" button on a
 * member row, which has nothing to announce and just states their details.
 */
export function buildMemberUpdateMessage(data: {
  name: string;
  gymId: number | string;
  changes: MemberChange[];
  expiry: string;
  feeAmount?: number;
  planType?: string | null;
  customNote?: string;
}) {
  const fee = data.feeAmount
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(data.feeAmount)
    : "";

  const lines: string[] = [];
  // Blank is a real state — the member import deliberately accepts a member
  // with no due date — and it must not reach a member as "valid till **".
  const expiryText = formatDateIn(data.expiry);

  if (data.changes.length > 0) {
    lines.push(
      `Hi ${data.name}!`,
      "",
      `We've updated your Brothers Gym membership (ID #${data.gymId}):`,
      ""
    );
    for (const c of data.changes) {
      lines.push(`• ${c.label}: ${c.from} → ${c.to}`);
    }
    lines.push(
      "",
      expiryText
        ? `Your membership is now valid till *${expiryText}*.`
        : "Your membership details have been updated."
    );
  } else {
    lines.push(
      `Hi ${data.name}!`,
      "",
      `Here are your current Brothers Gym membership details (ID #${data.gymId}):`,
      "",
      expiryText
        ? `• Due Date: *${expiryText}*`
        : "• Due Date: not recorded yet"
    );
    if (fee) lines.push(`• Fees: ${fee}`);
    if (data.planType) {
      lines.push(`• Plan: ${PLAN_LABELS[data.planType] ?? data.planType}`);
    }
  }

  lines.push(
    "",
    "If anything here looks wrong, just reply to this message.",
    "",
    "- Brothers Gym Team"
  );

  const base = lines.join("\n");
  return data.customNote?.trim()
    ? `${base}\n\n${data.customNote.trim()}`
    : base;
}

// ============================================
// SMS TEMPLATES (short, DLT-compliant, English-only)
// ============================================
// IMPORTANT: These must EXACTLY match your DLT-approved templates.
// Any change (even a comma) will cause delivery failure.
// Keep under 160 chars for single-segment cost (~₹0.25).
// Emojis / Hindi convert to Unicode → 70 char limit + higher cost.

export type SmsTemplateId = "reminder" | "expired" | "renewed";

export function generateSMSMessage(
  templateId: SmsTemplateId,
  data: {
    name: string;
    gymId: number | string;
    expiry: string;
    feeAmount?: number;
  }
) {
  const fee = data.feeAmount ? `Rs.${data.feeAmount}` : "Rs.0";

  const templates: Record<SmsTemplateId, string> = {
    reminder: `Hi ${data.name}, your Brothers Gym membership (ID ${data.gymId}) expires on ${data.expiry}. Please renew. Amount: ${fee}. -Brothers Gym`,

    expired: `Hi ${data.name}, your Brothers Gym membership (ID ${data.gymId}) has EXPIRED on ${data.expiry}. Please renew ${fee} to continue. -Brothers Gym`,

    renewed: `Hi ${data.name}, your Brothers Gym membership (ID ${data.gymId}) is renewed till ${data.expiry}. Thank you! -Brothers Gym`,
  };

  return templates[templateId];
}

/**
 * Returns SMS template variables as a plain object.
 * These get mapped to MSG91 Flow variables (VAR1, VAR2, etc.)
 * in the order they were defined in your MSG91 Flow.
 */
export function getSMSVariables(data: {
  name: string;
  gymId: number | string;
  expiry: string;
  feeAmount?: number;
}) {
  return {
    VAR1: data.name,
    VAR2: String(data.gymId),
    VAR3: data.expiry,
    VAR4: data.feeAmount ? `Rs.${data.feeAmount}` : "Rs.0",
  };
}