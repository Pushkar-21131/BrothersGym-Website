"use server";

import { db } from "@/db";
import { smsLogs, members } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
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
 * Send SMS via MSG91 Flow API.
 * Requires: owner OR staff with reminders.canSendSMS permission.
 */
export async function sendSMSReminder(
  memberId: number,
  phone: string,
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
  const cleanPhone = normalizeIndianPhone(phone);
  const cleanMessage = fullMessagePreview.trim();

  if (!Number.isInteger(memberId) || memberId <= 0) return { error: "Invalid member." };
  if (!cleanPhone) return { error: "Enter a valid 10-digit Indian phone number." };
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

  // Verify member exists & get branchId for logging
  const memberRow = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (memberRow.length === 0) return { error: "Member not found." };
  const branchId = memberRow[0].branchId;

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