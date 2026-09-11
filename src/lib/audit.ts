import { db } from "@/db";
import { cookies } from "next/headers";
import { loginAttempts } from "@/db/schema";
import { getClientInfo } from "@/lib/security";
import { getCurrentUser } from "@/lib/auth-check";

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
  // Staff/user events
  | "staff.created"
  | "staff.updated"
  | "staff.deleted"
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
  // System events
  | "settings.updated"
  | "sms.sent";

/**
 * Enhanced audit logging — saves to database AND console.
 * Use this for all new sensitive actions.
 *
 * Example:
 *   await logAuditEvent("member.deleted", `Deleted member #${gymId} (${name})`);
 */
export async function logAuditEvent(
  event: AuditEvent,
  details: string
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const user = await getCurrentUser();
    const name = user?.name || "unknown";
    const role = user?.role || "unknown";
    const branch = cookieStore.get("admin_branch")?.value || "all";

    // Get IP + user agent
    const { ip, userAgent } = await getClientInfo();

    // Console log for real-time visibility
    console.log(
      `[AUDIT] ${new Date().toISOString()} · ${role}:${name} (${branch}) · ${event} · ${details}`
    );

    // Save to database (reusing login_attempts table for now)
    // Format: reason="AUDIT:eventName|details"
    await db.insert(loginAttempts).values({
      email: name,
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 200) || "unknown", // Truncate long UAs
      success: true,
      reason: `AUDIT:${event}|role=${role}|branch=${branch}|${details.slice(0, 300)}`,
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
  const { desc, like } = await import("drizzle-orm");
  try {
    const logs = await db
      .select()
      .from(loginAttempts)
      .where(like(loginAttempts.reason, "AUDIT:%"))
      .orderBy(desc(loginAttempts.createdAt))
      .limit(limit);

    return logs.map((log) => {
      const reasonParts = (log.reason || "").split("|");
      const eventPart = reasonParts[0]?.replace("AUDIT:", "") || "unknown";

      return {
        id: log.id,
        event: eventPart,
        actor: log.email,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        details: reasonParts.slice(1).join(" · "),
        timestamp: log.createdAt,
      };
    });
  } catch (err) {
    console.error("[Audit] Failed to fetch logs:", err);
    return [];
  }
}