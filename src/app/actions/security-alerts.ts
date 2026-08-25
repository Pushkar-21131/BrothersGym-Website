"use server";

import { Resend } from "resend";
import { getClientInfo } from "@/lib/security";
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