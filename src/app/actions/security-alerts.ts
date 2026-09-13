"use server";

import { Resend } from "resend";
import { getClientInfo, checkDailyEmailCap } from "@/lib/security";
import { escapeHtml, fromHeader } from "@/lib/email-templates";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendSecurityAlert(data: {
  type: "failed-owner-login" | "new-login-success" | "suspicious";
  email: string;
  attempts?: number;
}) {
  if (!process.env.RESEND_API_KEY || !process.env.OWNER_EMAIL) return;

  try {
    const { ip, userAgent } = await getClientInfo();
    const time = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });

    let subject = "";
    let body = "";

    if (data.type === "failed-owner-login") {
      subject = "Failed login attempt — Brothers Gym";
      // Every value below is attacker-supplied: the email comes straight from
      // the login form and the user agent from the request headers. Escaped so
      // a crafted login can't inject markup into the owner's inbox.
      body = `
        <h2 style="color:#ef4444;margin:0 0 16px 0;">Someone tried to log in to your account</h2>
        <p><b>Attempted email:</b> ${escapeHtml(data.email)}</p>
        <p><b>IP address:</b> ${escapeHtml(ip)}</p>
        <p><b>Device:</b> ${escapeHtml(userAgent.slice(0, 100))}</p>
        <p><b>Time:</b> ${escapeHtml(time)} IST</p>
        <p><b>Failed attempts so far:</b> ${Number(data.attempts) || 1}</p>
        <hr />
        <p style="color:#666;font-size:12px;">
          If this was you, ignore this email. If not, someone knows your email —
          consider changing your password immediately.
        </p>
      `;
    }

    // The other alert types have no template yet. Without this guard they sent
    // a real email with an empty subject and an empty body.
    if (!subject || !body) return;

    // ===== DAILY CAP =====
    // This fires on every failed owner login, and nothing bounded it. The rate
    // limiter lets 5 attempts through per 15-minute window before a 30-minute
    // block, so a patient script can keep ~5 alerts per half hour flowing — 240
    // a day against a Resend free allowance of 100 that the owner's own login
    // OTP comes out of. The alert warning about an attack was itself the way to
    // lock the owner out of responding to one.
    //
    // Namespaced per alert type, deliberately not keyed on OWNER_EMAIL:
    // checkDailyEmailCap builds `email-daily:<address>`, which is exactly the
    // key the owner's OTP uses, so capping on the owner's address would spend
    // the OTP quota and cause the lockout this exists to prevent. Per type also
    // means a flood of login alerts cannot suppress a different alert later.
    //
    // 20 is well past the point of diminishing returns: after the second email
    // the owner knows, and /admin/security holds the complete login_attempts
    // log either way, so a suppressed alert loses no evidence.
    //
    // Placed after the template guard so only real sends are counted — see the
    // note on checkDailyEmailCap.
    const cap = await checkDailyEmailCap(`security-alert:${data.type}`, 20);
    if (!cap.allowed) return;

    await resend.emails.send({
      from: fromHeader(),
      to: process.env.OWNER_EMAIL,
      subject,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:20px;max-width:600px;">${body}</div>`,
    });
  } catch (e) {
    console.error("Security alert email failed:", e);
  }
}