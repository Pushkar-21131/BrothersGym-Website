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