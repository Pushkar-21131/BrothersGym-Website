"use server";

import { db } from "@/db";
import { smsLogs, members } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertBranchInScope, getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/security";
import {
  assertAuthenticated,
  assertPermission,
  getCurrentUser,
} from "@/lib/auth-check";

function normalizeIndianPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const ten = digits.slice(-10);
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return ten;
}

/**
 * How many messages one admin account may send per hour.
 *
 * Sized ABOVE a legitimate bulk send, not below it: sendAllSMS() in the
 * reminders panel loops the whole expiring-members list, one send every 400ms,
 * and a few hundred members is an ordinary day for a gym. A cap that cut a real
 * bulk send short would silently stop half the reminders — members would simply
 * not hear from the gym, and the counter would report the failure as a normal
 * error. What this stops is the runaway case: a scripted client, a retry loop,
 * or a compromised staff account, against a template that costs real money per
 * message and carries the gym's DLT registration.
 */
const SMS_HOURLY_CAP = 500;

/**
 * Send SMS via MSG91 Flow API.
 * Requires: owner OR staff with reminders.canSendSMS permission.
 *
 * The recipient number is NOT a parameter. It used to be, and the caller could
 * pass anything — the member row was loaded and then used only for its branchId
 * in the log. A staff account with reminders.canSendSMS could therefore spend the
 * gym's paid MSG91 traffic sending to any Indian mobile, with caller-supplied
 * template variables, and file the cost against whichever branch's books it
 * named. The reminders panel never used the freedom: both call sites pass
 * `member.contactNumber`, so the number is derived from the member row instead.
 */
export async function sendSMSReminder(
  memberId: number,
  variables: Record<string, string>,
  fullMessagePreview: string
) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("reminders", "canSendSMS");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to send SMS") };
  }

  const currentUser = await getCurrentUser();
  const sender = currentUser?.name || "Staff";
  const cleanMessage = fullMessagePreview.trim();

  if (!Number.isInteger(memberId) || memberId <= 0) return { error: "Invalid member." };
  if (!cleanMessage) return { error: "SMS message cannot be empty." };
  if (!variables || Object.keys(variables).length === 0) {
    return { error: "SMS variables missing." };
  }

  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey || !templateId) {
    return {
      error: "MSG91 not configured. Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.",
    };
  }

  // Load the member first: this row decides which branch the send is billed to
  // AND which number it goes to.
  const memberRow = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (memberRow.length === 0) return { error: "Member not found." };

  const member = memberRow[0];
  const branchId = member.branchId;

  // Hold the member to the caller's branch. Staff and branch owners are locked to
  // their own gym, so an id from the other one must not be sendable. Same message
  // as "not found" so ids cannot be probed across branches.
  try {
    await assertBranchInScope(branchId, "member");
  } catch {
    return { error: "Member not found." };
  }

  // Per-sender cap, keyed on the admin account rather than the IP: this is about
  // spend, and the account is what a caller cannot rotate. Fails OPEN on a
  // database blip (the `sms` prefix is deliberately not in FAIL_CLOSED_PREFIXES),
  // because blocking a paying gym from reminding its members is worse than the
  // burst a blip would let through — the branch scope above is the real gate.
  const senderLimit = await checkRateLimit(
    `sms:${currentUser?.id ?? "owner"}`,
    { max: SMS_HOURLY_CAP, windowMinutes: 60, blockMinutes: 15 }
  );
  if (!senderLimit.allowed) {
    return {
      error: `Too many messages sent. Try again in ${senderLimit.blockMinutesLeft} minutes.`,
    };
  }

  const cleanPhone = normalizeIndianPhone(member.contactNumber || "");
  if (!cleanPhone) {
    return { error: "This member has no valid 10-digit phone number on file." };
  }

  try {
    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify({
        template_id: templateId,
        short_url: "0",
        recipients: [
          {
            mobiles: `91${cleanPhone}`,
            ...variables,
          },
        ],
      }),
      cache: "no-store",
    });

    const responseText = await response.text();
    let responseData: unknown = responseText;
    try {
      responseData = JSON.parse(responseText);
    } catch {}

    const status = response.ok ? "sent" : "failed";

    await db.insert(smsLogs).values({
      branchId,
      memberId,
      phoneNumber: cleanPhone,
      message: cleanMessage,
      status,
      cost: response.ok ? 25 : 0,
      sentBy: sender,
    });

    revalidatePath("/admin/reminders");

    if (!response.ok) {
      console.error("MSG91 SMS error:", responseData);
      return {
        error:
          typeof responseData === "string"
            ? `SMS failed: ${responseData}`
            : `SMS failed: ${JSON.stringify(responseData)}`,
      };
    }

    return { success: true, providerResponse: responseData };
  } catch (error) {
    const message = sanitizeError(error, "SMS send failed");

    try {
      await db.insert(smsLogs).values({
        branchId,
        memberId,
        phoneNumber: cleanPhone,
        message: cleanMessage,
        status: "failed",
        cost: 0,
        sentBy: sender,
      });
    } catch (logErr) {
      console.error("Failed to save SMS failure log:", logErr);
    }

    return { error: message };
  }
}

// ===== SMS STATS =====
export async function getSMSStats() {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("reminders", "canView");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized") };
  }

  try {
    const scope = await getBranchScope();

    const logs = await db
      .select()
      .from(smsLogs)
      .where(
        scope.type === "single"
          ? eq(smsLogs.branchId, scope.branchId)
          : inArray(smsLogs.branchId, scope.branchIds)
      );

    const totalSent = logs.filter((l) => l.status === "sent").length;
    const totalFailed = logs.filter((l) => l.status === "failed").length;
    const totalCost =
      logs.filter((l) => l.status === "sent").reduce((s, l) => s + (l.cost || 0), 0) / 100;

    return { totalSent, totalFailed, totalCost };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to load SMS statistics.") };
  }
}