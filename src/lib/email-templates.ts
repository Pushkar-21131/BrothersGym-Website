/**
 * Transactional email templates.
 *
 * Written as tables with inline styles on purpose — that is the only layout
 * that survives Gmail, Outlook and Apple Mail intact. Anything here that comes
 * from a request (a name, a user agent) must go through escapeHtml first:
 * deviceInfo in particular is taken from the client's navigator.userAgent, so
 * without escaping an attacker could inject markup straight into the owner's
 * inbox by triggering a login.
 */

import { formatDayIST } from "@/lib/manual-join";

const BRAND = {
  name: "Brothers Gym",
  gold: "#eab308",
  goldSoft: "#fde68a",
  bg: "#09090b",
  card: "#18181b",
  cardInner: "#0f0f12",
  border: "#27272a",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  faint: "#71717a",
  danger: "#f87171",
  branches: "Nangal Raya · Sagar Pur · West Delhi",
};

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nowIST(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The From header.
 *
 * The display name is what a phone's mail app actually shows in the list, so it
 * must be the gym's name even while the underlying address is still Resend's
 * shared sender. FROM_EMAIL may be either a bare address or a full
 * "Name <address>" header; a bare one gets the brand name attached.
 */
export function fromHeader(): string {
  const configured = (process.env.FROM_EMAIL || "").trim();
  const displayName = (process.env.FROM_NAME || BRAND.name).trim();

  if (!configured) return `${displayName} <onboarding@resend.dev>`;
  if (configured.includes("<")) return configured;
  return `${displayName} <${configured}>`;
}

type OtpEmailOptions = {
  /** Drives the wording; the layout is identical either way. */
  kind: "login" | "reset";
  otp: string;
  /** Recipient's name. Omitted for the login code, which goes only to the owner. */
  name?: string;
  /** Raw user agent of whoever triggered this. Escaped before rendering. */
  deviceInfo?: string;
  expiresMinutes: number;
};

export function otpEmail(opts: OtpEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const { kind, otp, name, deviceInfo, expiresMinutes } = opts;
  const isLogin = kind === "login";

  const subject = isLogin
    ? `${otp} is your ${BRAND.name} login code`
    : `${otp} is your ${BRAND.name} password reset code`;

  const heading = isLogin ? "Login verification" : "Password reset";
  const lead = isLogin
    ? "Use this code to finish signing in to your admin panel."
    : "Use this code to set a new password on your account.";
  const preheader = `Your code is ${otp}. It expires in ${expiresMinutes} minutes.`;

  const warning = isLogin
    ? "If you did not just try to sign in, someone else has your password. Change it as soon as you can — this code alone will not let them in."
    : "If you did not request a reset, you can ignore this email. Nothing has changed on your account yet.";

  const safeName = name ? escapeHtml(name) : "";
  const safeDevice = deviceInfo ? escapeHtml(deviceInfo) : "";
  const timestamp = nowIST();

  // Kept as a single fluid 600px table: no media queries, so it renders the
  // same in clients that strip <style> blocks (most mobile apps do).
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:24px 12px;">
  <tr>
    <td align="center">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="padding:32px 32px 24px 32px;border-bottom:1px solid ${BRAND.border};" align="center">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">
              Brothers<span style="color:${BRAND.gold};">Gym</span>
            </div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;color:${BRAND.faint};text-transform:uppercase;padding-top:8px;">
              ${BRAND.branches}
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:20px;font-weight:bold;color:#ffffff;padding-bottom:12px;">${heading}</div>
            ${
              safeName
                ? `<div style="font-size:16px;color:${BRAND.text};padding-bottom:8px;">Hi ${safeName},</div>`
                : ""
            }
            <div style="font-size:16px;line-height:24px;color:${BRAND.muted};">${lead}</div>
          </td>
        </tr>

        <!-- Code -->
        <tr>
          <td style="padding:0 32px 8px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardInner};border:1px solid ${BRAND.gold};border-radius:12px;">
              <tr>
                <td align="center" style="padding:28px 16px;font-family:Arial,Helvetica,sans-serif;">
                  <div style="font-size:11px;letter-spacing:2px;color:${BRAND.faint};text-transform:uppercase;padding-bottom:14px;">
                    Your code
                  </div>
                  <div style="font-family:'Courier New',Courier,monospace;font-size:38px;line-height:44px;font-weight:bold;letter-spacing:10px;color:${BRAND.gold};text-indent:10px;">
                    ${escapeHtml(otp)}
                  </div>
                  <div style="font-size:13px;color:${BRAND.faint};padding-top:14px;">
                    Expires in ${expiresMinutes} minutes
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Request details -->
        <tr>
          <td style="padding:24px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardInner};border-radius:10px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font-size:12px;color:${BRAND.faint};padding-bottom:6px;">
                    <strong style="color:${BRAND.muted};">Requested:</strong> ${escapeHtml(timestamp)} IST
                  </div>
                  ${
                    safeDevice
                      ? `<div style="font-size:12px;line-height:18px;color:${BRAND.faint};word-break:break-word;">
                    <strong style="color:${BRAND.muted};">Device:</strong> ${safeDevice}
                  </div>`
                      : ""
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Security note -->
        <tr>
          <td style="padding:16px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-left:3px solid ${BRAND.danger};padding:4px 0 4px 14px;">
                  <div style="font-size:13px;line-height:20px;color:${BRAND.muted};">
                    <strong style="color:${BRAND.danger};">Didn't ask for this?</strong><br>
                    ${warning}
                  </div>
                </td>
              </tr>
            </table>
            <div style="font-size:13px;line-height:20px;color:${BRAND.faint};padding-top:20px;">
              Never share this code. ${BRAND.name} staff will never ask you for it.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px 32px;border-top:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif;" align="center">
            <div style="font-size:12px;color:${BRAND.faint};line-height:18px;">
              Automated message from ${BRAND.name} — please do not reply.
            </div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  // null = omit this line entirely; "" = a deliberate blank spacer.
  const text = [
    `${BRAND.name} — ${heading}`,
    "",
    name ? `Hi ${name},` : null,
    lead,
    "",
    `Your code: ${otp}`,
    `Expires in ${expiresMinutes} minutes.`,
    "",
    `Requested: ${timestamp} IST`,
    deviceInfo ? `Device: ${deviceInfo}` : null,
    "",
    `Didn't ask for this? ${warning}`,
    "",
    `Never share this code. ${BRAND.name} staff will never ask you for it.`,
    "",
    `Automated message from ${BRAND.name} — please do not reply.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, html, text };
}

// ============================================================================
// MANUAL UPI JOIN FLOW
// ============================================================================

/**
 * The shared 600px shell for the newer transactional emails (the join flow).
 * `otpEmail` predates this and keeps its own copy — not worth the churn (and the
 * risk to a security-critical template) to migrate it. Callers pass the inner
 * `<tr>` rows; the header, preheader and footer are added here.
 */
function emailShell(opts: {
  subject: string;
  preheader: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="padding:32px 32px 24px 32px;border-bottom:1px solid ${BRAND.border};" align="center">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">
              Brothers<span style="color:${BRAND.gold};">Gym</span>
            </div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;color:${BRAND.faint};text-transform:uppercase;padding-top:8px;">
              ${BRAND.branches}
            </div>
          </td>
        </tr>

        ${opts.bodyHtml}

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px 32px;border-top:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif;" align="center">
            <div style="font-size:12px;color:${BRAND.faint};line-height:18px;">
              Automated message from ${BRAND.name} — please do not reply.
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Render a label/value list as table rows for the detail cards below. */
function detailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([k, v]) => `<tr>
                <td style="padding:8px 0;font-size:13px;color:${BRAND.faint};font-family:Arial,Helvetica,sans-serif;">${k}</td>
                <td style="padding:8px 0 8px 16px;font-size:14px;color:${BRAND.text};text-align:right;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${v}</td>
              </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`;
}

/**
 * Sent to the MEMBER once the owner confirms their UPI payment. Carries the Gym
 * ID prominently — it's what they show at the counter — plus the plan, amount
 * and expiry so the email doubles as a receipt.
 *
 * Note (not a bug to fix here): until the `brothersgym.in` domain is verified in
 * Resend, the shared `onboarding@resend.dev` sender only delivers to the Resend
 * account owner, so member delivery is unreliable until then — which is exactly
 * why the owner also gets a one-tap WhatsApp link to send the Gym ID by hand.
 */
export function joinConfirmedEmail(opts: {
  memberName: string;
  gymId: number;
  planName?: string;
  amount: number;
  expiry: string;
  branchName: string;
  isRenewal?: boolean;
}): { subject: string; html: string; text: string } {
  const name = escapeHtml(opts.memberName || "there");
  const validUntil = formatDayIST(opts.expiry);
  const amountStr = `₹${opts.amount.toLocaleString("en-IN")}`;

  const heading = opts.isRenewal ? "Membership renewed" : "Membership confirmed";
  const lead = opts.isRenewal
    ? "Your payment is confirmed and your membership has been extended. See you at the gym!"
    : "Your payment is confirmed and your membership is now active. Welcome to the family!";
  const subject = opts.isRenewal
    ? `Your ${BRAND.name} membership is renewed`
    : `Welcome to ${BRAND.name} — membership confirmed`;
  const preheader = `Gym ID ${opts.gymId}${validUntil ? ` · valid until ${validUntil}` : ""}`;

  const rows: Array<[string, string]> = [];
  if (opts.planName) rows.push(["Plan", escapeHtml(opts.planName)]);
  rows.push(["Amount paid", amountStr]);
  if (validUntil) rows.push(["Valid until", validUntil]);
  if (opts.branchName) rows.push(["Branch", escapeHtml(opts.branchName)]);

  const bodyHtml = `
        <!-- Intro -->
        <tr>
          <td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:20px;font-weight:bold;color:#ffffff;padding-bottom:12px;">${heading}</div>
            <div style="font-size:16px;color:${BRAND.text};padding-bottom:8px;">Hi ${name},</div>
            <div style="font-size:16px;line-height:24px;color:${BRAND.muted};">${lead}</div>
          </td>
        </tr>

        <!-- Gym ID -->
        <tr>
          <td style="padding:20px 32px 8px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardInner};border:1px solid ${BRAND.gold};border-radius:12px;">
              <tr>
                <td align="center" style="padding:24px 16px;font-family:Arial,Helvetica,sans-serif;">
                  <div style="font-size:11px;letter-spacing:2px;color:${BRAND.faint};text-transform:uppercase;padding-bottom:10px;">Your Gym ID</div>
                  <div style="font-family:'Courier New',Courier,monospace;font-size:40px;line-height:44px;font-weight:bold;letter-spacing:6px;color:${BRAND.gold};">${opts.gymId}</div>
                  <div style="font-size:13px;color:${BRAND.faint};padding-top:12px;">Show this at the counter</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Details -->
        <tr>
          <td style="padding:16px 32px 24px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardInner};border-radius:10px;">
              <tr><td style="padding:6px 18px;">${detailTable(rows)}</td></tr>
            </table>
          </td>
        </tr>`;

  const html = emailShell({ subject, preheader, bodyHtml });

  const text = [
    `${BRAND.name} — ${heading}`,
    "",
    `Hi ${opts.memberName || "there"},`,
    lead,
    "",
    `Gym ID: ${opts.gymId}`,
    opts.planName ? `Plan: ${opts.planName}` : null,
    `Amount paid: ${amountStr}`,
    validUntil ? `Valid until: ${validUntil}` : null,
    opts.branchName ? `Branch: ${opts.branchName}` : null,
    "",
    "Show your Gym ID at the counter.",
    "",
    `Automated message from ${BRAND.name} — please do not reply.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject, html, text };
}

/**
 * Sent to the OWNER when a member taps "I've paid". A heads-up, not an
 * instruction: nothing is activated until the owner checks their own bank/UPI
 * record and clicks Confirm. Links straight to the Join Requests page when a
 * site URL is configured.
 */
export function ownerNewJoinAlertEmail(opts: {
  memberName: string;
  contactNumber: string;
  amount: number;
  branchName: string;
  reference: string;
  upiReference?: string | null;
  isRenewal?: boolean;
  planName?: string;
}): { subject: string; html: string; text: string } {
  const amountStr = `₹${opts.amount.toLocaleString("en-IN")}`;
  const kind = opts.isRenewal ? "renewal" : "new join";
  const subject = `${amountStr} UPI claim — ${opts.memberName || "member"} (${opts.reference})`;
  const lead = `${escapeHtml(opts.memberName || "Someone")} says they've paid by UPI for a ${kind}. Check the money landed in your account, then confirm it in the admin panel to activate the membership.`;
  const preheader = `${opts.reference} · ${amountStr} · ${opts.contactNumber}`;

  const site = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const adminUrl = site ? `${site}/admin/join-requests` : "";

  const rows: Array<[string, string]> = [
    ["Member", escapeHtml(opts.memberName || "—")],
    ["Phone", escapeHtml(opts.contactNumber)],
  ];
  if (opts.planName) rows.push(["Plan", escapeHtml(opts.planName)]);
  rows.push(["Amount", amountStr]);
  rows.push(["Reference", escapeHtml(opts.reference)]);
  if (opts.branchName) rows.push(["Branch", escapeHtml(opts.branchName)]);
  rows.push([
    "UTR / Ref no.",
    opts.upiReference ? escapeHtml(opts.upiReference) : "— not provided —",
  ]);

  const button = adminUrl
    ? `
        <tr>
          <td style="padding:8px 32px 24px 32px;" align="center">
            <a href="${adminUrl}" style="display:inline-block;background:${BRAND.gold};color:#09090b;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:10px;">Open Join Requests</a>
          </td>
        </tr>`
    : "";

  const bodyHtml = `
        <!-- Intro -->
        <tr>
          <td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:20px;font-weight:bold;color:#ffffff;padding-bottom:12px;">New payment to confirm</div>
            <div style="font-size:16px;line-height:24px;color:${BRAND.muted};">${lead}</div>
          </td>
        </tr>

        <!-- Details -->
        <tr>
          <td style="padding:20px 32px 8px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardInner};border-radius:10px;">
              <tr><td style="padding:6px 18px;">${detailTable(rows)}</td></tr>
            </table>
          </td>
        </tr>
${button}
        <!-- Note -->
        <tr>
          <td style="padding:0 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:13px;line-height:20px;color:${BRAND.faint};">
              Nothing is activated until you confirm. If you don't recognise this, reject it in the panel.
            </div>
          </td>
        </tr>`;

  const html = emailShell({ subject, preheader, bodyHtml });

  const text = [
    `${BRAND.name} — new payment to confirm`,
    "",
    `${opts.memberName || "Someone"} says they've paid by UPI for a ${kind}.`,
    "Check your account, then confirm in the admin panel.",
    "",
    `Member: ${opts.memberName || "—"}`,
    `Phone: ${opts.contactNumber}`,
    opts.planName ? `Plan: ${opts.planName}` : null,
    `Amount: ${amountStr}`,
    `Reference: ${opts.reference}`,
    opts.branchName ? `Branch: ${opts.branchName}` : null,
    `UTR / Ref no.: ${opts.upiReference || "not provided"}`,
    "",
    adminUrl ? `Confirm here: ${adminUrl}` : "Open the admin panel → Join Requests to confirm.",
    "",
    "Nothing is activated until you confirm.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject, html, text };
}
