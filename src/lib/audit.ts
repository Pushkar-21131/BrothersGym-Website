import { db } from "@/db";
import { activityLogs, loginAttempts } from "@/db/schema";
import { getClientInfo } from "@/lib/security";
import { assertOwner, getCurrentUser } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { recordActivity, type ActivityOptions } from "@/lib/activity";
import { getHistoryRange } from "./activity-history";

/**
 * Sensitive action types that should be audited.
 * Add new events here as needed.
 */
export type AuditEvent =
  // Member events
  | "member.created"
  | "member.updated"
  | "member.deleted"
  | "member.renewed"
  | "member.marked_left"
  | "member.restored"
  | "member.imported"
  // Payment events
  | "payment.online.success"
  | "payment.online.failed"
  | "payment.recorded_offline"
  | "payment.refund_requested"
  // A payment row is never deleted, so these two are the whole story of an
  // entry leaving a member's timeline and coming back.
  | "payment.voided"
  | "payment.restored"
  // Staff/user events
  | "staff.created"
  | "staff.updated"
  | "staff.deleted"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "permissions.updated"
  // Plan events
  | "plan.updated"
  | "plan.toggled"
  // Branch events
  | "branch.switched"
  | "branch.updated"
  // Security events
  | "password.reset_requested"
  | "password.reset_completed"
  | "password.changed"
  | "login.suspicious"
  // Data events
  | "data.exported"
  | "data.imported"
  // Trainer/Review events
  | "trainer.created"
  | "trainer.updated"
  | "trainer.deleted"
  | "review.created"
  | "review.updated"
  | "review.deleted"
  // Equipment events
  | "equipment.added"
  | "equipment.updated"
  | "equipment.deleted"
  | "enquiry.created"
  | "enquiry.updated"
  | "enquiry.deleted"
  | "enquiry.contacted"
  | "enquiry.imported"
  | "join.rejected"
  | "join.proof_deleted"
  // System events
  | "settings.updated"
  | "sms.sent";

/**
 * Best-effort logging for operations that have already completed. Mutations
 * use recordActivity / withActivity to commit their history atomically.
 *
 * Example:
 *   await logAuditEvent("member.deleted", `Deleted member #${gymId} (${name})`);
 */
export async function logAuditEvent(
  event: AuditEvent,
  details: string,
  options?: ActivityOptions,
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("Audit requires an authenticated actor");
    const scope = options ? null : await getBranchScope();
    await recordActivity(db, event, details, options ?? {
      branchId: scope?.type === "single" ? scope.branchId : null, actor: user,
    });
  } catch (err) {
    // Don't fail the main operation if audit fails
    console.error("[Audit] Failed to log event:", event, err);
  }
}

/**
 * Log a security event (failed operations, suspicious activity).
 * These are separate from normal audit events for easier filtering.
 */
export async function logSecurityEvent(
  event: string,
  details: string,
  severity: "low" | "medium" | "high" = "medium"
): Promise<void> {
  try {
    const user = await getCurrentUser();
    const name = user?.name || "anonymous";
    const { ip, userAgent } = await getClientInfo();

    console.warn(
      `[SECURITY:${severity.toUpperCase()}] ${new Date().toISOString()} · ${name} · ${event} · ${details}`
    );

    await db.insert(loginAttempts).values({
      email: name,
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 200) || "unknown",
      success: false,
      reason: `SECURITY:${severity}:${event}|${details.slice(0, 300)}`,
    });
  } catch (err) {
    console.error("[Security] Failed to log event:", event, err);
  }
}

/**
 * Retrieve recent audit logs (owner only — use in admin dashboard).
 */
export async function getRecentAuditLogs(limit: number = 100) {
  await assertOwner();
  const scope = await getBranchScope();
  const { and, desc, eq, gte, inArray, isNull, or } = await import("drizzle-orm");
  const { start } = getHistoryRange("all");
    const logs = await db
      .select()
      .from(activityLogs)
      .where(and(gte(activityLogs.createdAt, start), scope.type === "single"
        ? eq(activityLogs.branchId, scope.branchId)
        : or(inArray(activityLogs.branchId, scope.branchIds), isNull(activityLogs.branchId))))
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 100);
    return logs.map((log) => ({
        id: log.id,
        event: log.event,
        actor: log.actorName,
        details: log.details,
        timestamp: log.createdAt,
    }));
}
