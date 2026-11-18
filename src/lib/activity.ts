import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { getCurrentUser, type CurrentUser } from "@/lib/auth-check";
import type { ActivityChange } from "./activity-history";
import type { AuditEvent } from "./audit";
import { isHistoryEnabled } from "./history-release";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ActivityOptions = {
  branchId: number | null;
  subjectId?: number;
  changes?: ActivityChange[];
  actor?: CurrentUser | null;
};

export async function recordActivity(
  connection: Transaction | typeof db,
  event: AuditEvent,
  details: string,
  options: ActivityOptions,
) {
  if (!isHistoryEnabled()) return;
  const actor = options.actor === undefined ? await getCurrentUser() : options.actor;
  await connection.insert(activityLogs).values({
    branchId: options.branchId,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? "System",
    actorRole: actor?.role ?? "system",
    event,
    subjectId: options.subjectId,
    details: details.slice(0, 1000),
    changes: options.changes ?? [],
  });
}

/** The change and its history entry either both commit or both roll back. */
export async function withActivity<T>(
  event: AuditEvent,
  details: string,
  options: ActivityOptions,
  change: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const actor = options.actor === undefined ? await getCurrentUser() : options.actor;
  if (!actor) throw new Error("Unauthorized: authentication required");
  return db.transaction(async (tx) => {
    const result = await change(tx);
    await recordActivity(tx, event, details, { ...options, actor });
    return result;
  });
}
