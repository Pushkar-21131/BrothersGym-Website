"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";
import { istDateString } from "@/lib/utils";
import { sql } from "drizzle-orm";

export type MemberPlanType = "full" | "no_cardio" | "offline";

export type ImportMemberRow = {
  gymId: number;
  name: string;
  email?: string | null;
  contactNumber: string;
  address?: string | null;
  parentName?: string | null;
  emergencyContact: string;
  feeAmount: number;
  joiningDate?: string;
  membershipExpiry: string;
  /**
   * Parsed from the owner's register by the import screen. "full" is Cardio, and
   * the client sends "no_cardio" for rows with no C — see the note there.
   */
  planType?: MemberPlanType;
};

export type ImportOutcome =
  | { error: string }
  | {
      /** Rows written — inserted, plus updated when `updateExisting` was set. */
      written: number;
      /** Rows left alone because that M.No was already in the branch. */
      skippedExisting: number;
      errors: string[];
      branchName: string;
    };

type MemberInsert = typeof members.$inferInsert;

// ===== WHY THIS IS BATCHED =====
//
// This used to be one `await db.insert(members).values({...})` per row, in a
// loop, and that is what lost the owner's register. A measured round trip to
// this Neon instance from the functions' region is 78ms median, so 1500 rows
// takes about two minutes — against Netlify's 10s synchronous function limit,
// which netlify.toml does not raise. The function was killed inside the loop at
// roughly row 126 (126 x 78ms = 9.8s), and because nothing wrapped the loop in a
// transaction the rows already written stayed written. The browser got no
// response at all, so the screen just said "Importing..." forever and the owner
// had no way to know two thirds of his book was missing.
//
// One statement per 250 rows turns ~1500 round trips into 6. The wall-clock
// budget is the constraint being designed around here — not raised, because the
// fix is to make the work fit, not to move the ceiling.
const INSERT_CHUNK = 250;

const PLAN_TYPES = new Set<string>(["full", "no_cardio", "offline"]);

/**
 * `planType` arrives from the browser, so it is whitelisted rather than trusted;
 * anything unrecognised falls back to the column's own default instead of
 * reaching the insert.
 */
function planTypeOf(value: unknown): MemberPlanType {
  return typeof value === "string" && PLAN_TYPES.has(value)
    ? (value as MemberPlanType)
    : "offline";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why this row cannot be imported, or null if it can. Mirrors the client's own
 * check so the preview and the server never disagree about "ready".
 *
 * A missing phone or due date is deliberately not a reason. The owner's register
 * has gaps in both and a member with no number is still a member — dropping the
 * row loses his record entirely. A missing due date is dated today by
 * toInsertValues, since the column cannot hold "unknown".
 */
function invalidReason(row: ImportMemberRow): string | null {
  if (!Number.isFinite(Number(row.gymId)) || Number(row.gymId) <= 0)
    return "no M.No";
  if (!row.name) return "no name";
  if (!Number.isFinite(Number(row.feeAmount)) || Number(row.feeAmount) <= 0)
    return "no fee";
  return null;
}

function toInsertValues(
  row: ImportMemberRow,
  branchId: number,
  today: string
): MemberInsert {
  const rawExpiry = String(row.membershipExpiry ?? "").trim();
  return {
    branchId,
    gymId: Math.floor(Number(row.gymId)),
    name: String(row.name),
    email: row.email || null,
    contactNumber: String(row.contactNumber ?? "").trim(),
    address: row.address || null,
    parentName: row.parentName || null,
    emergencyContact: String(
      row.emergencyContact || row.contactNumber || "N/A"
    ),
    feeAmount: Math.floor(Number(row.feeAmount)),
    joiningDate: row.joiningDate || today,
    membershipExpiry: ISO_DATE.test(rawExpiry) ? rawExpiry : today,
    planType: planTypeOf(row.planType),
  };
}

/**
 * One statement for the whole chunk.
 *
 * The default skips a member whose M.No is already in the branch and reports
 * how many it skipped, so re-running a sheet can never overwrite anything.
 * `updateExisting` is the deliberate repair switch — it rewrites the imported
 * columns and nothing else, so a member's `leftGym`, `wonBackAt` and consent
 * record survive, and no `createdAt` is disturbed.
 *
 * `excluded.*` rather than literal values in the SET: a single statement carries
 * many different rows, so each conflicting row has to be updated from its own
 * incoming values. That is also why the caller dedupes by M.No first — Postgres
 * rejects "ON CONFLICT DO UPDATE" outright with "cannot affect row a second
 * time" if one statement touches the same conflict target twice.
 */
async function insertChunk(
  values: MemberInsert[],
  updateExisting: boolean
): Promise<{ written: number; skipped: number }> {
  if (updateExisting) {
    const rows = await db
      .insert(members)
      .values(values)
      .onConflictDoUpdate({
        target: [members.branchId, members.gymId],
        set: {
          name: sql`excluded.name`,
          email: sql`excluded.email`,
          contactNumber: sql`excluded.contact_number`,
          address: sql`excluded.address`,
          parentName: sql`excluded.parent_name`,
          emergencyContact: sql`excluded.emergency_contact`,
          feeAmount: sql`excluded.fee_amount`,
          joiningDate: sql`excluded.joining_date`,
          membershipExpiry: sql`excluded.membership_expiry`,
          planType: sql`excluded.plan_type`,
        },
      })
      .returning({ id: members.id });
    return { written: rows.length, skipped: 0 };
  }

  const rows = await db
    .insert(members)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: members.id });

  // RETURNING yields only the rows actually inserted, so the difference is the
  // ones the unique index turned away.
  return { written: rows.length, skipped: values.length - rows.length };
}

export async function importMembersAction(
  rows: ImportMemberRow[],
  targetBranchId?: number,
  updateExisting = false
): Promise<ImportOutcome> {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("import", "canUse");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to import members") };
  }

  if (!rows?.length) return { error: "No rows to import" };

  let branch;
  try {
    branch = await requireSingleBranch(targetBranchId);
  } catch (e) {
    return { error: sanitizeError(e, "Please select a branch to import into") };
  }

  const today = istDateString();
  const errors: string[] = [];

  // ===== DEDUPE BEFORE BUILDING THE STATEMENTS =====
  // Two rows sharing an M.No in one statement is not a duplicate the database
  // can resolve — with DO UPDATE it is a hard error, and with DO NOTHING the
  // second row is silently discarded. Either way it is worth naming: it means
  // the sheet itself needs a look. The first row wins.
  const seen = new Set<number>();
  const pending: MemberInsert[] = [];

  for (const row of rows) {
    const reason = invalidReason(row);
    if (reason) {
      errors.push(`${row.name || `M.No ${row.gymId}` || "Row"}: ${reason}`);
      continue;
    }

    const gymId = Math.floor(Number(row.gymId));
    if (seen.has(gymId)) {
      errors.push(
        `M.No ${gymId} (${row.name}) appears more than once in the file — kept the first, skipped this one.`
      );
      continue;
    }
    seen.add(gymId);
    pending.push(toInsertValues(row, branch.branchId, today));
  }

  let written = 0;
  let skippedExisting = 0;

  for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
    const chunk = pending.slice(i, i + INSERT_CHUNK);
    try {
      const result = await insertChunk(chunk, updateExisting);
      written += result.written;
      skippedExisting += result.skipped;
    } catch {
      // A multi-row INSERT is atomic, so ONE bad row would otherwise take the
      // other 249 down with it — and per-row reporting is the whole point here.
      // Re-run just this chunk one row at a time to isolate the offender and
      // keep everything else. Only a chunk that actually failed pays this.
      for (const values of chunk) {
        try {
          const result = await insertChunk([values], updateExisting);
          written += result.written;
          skippedExisting += result.skipped;
        } catch (rowError) {
          errors.push(
            `${values.name} (M.No ${values.gymId}): ${sanitizeError(rowError, "failed")}`
          );
        }
      }
    }
  }

  // ===== NO PAYMENT ROW ON IMPORT =====
  // Kept exactly as it was. For a bulk import of existing members that money was
  // collected long ago, often before this system existed, and a payment row
  // dated the joining date lands in the CURRENT dashboard totals as if it were
  // taken today — inflating the revenue figure the owner makes decisions from by
  // the whole imported book. The fee and the expiry live on the member row,
  // which is where the members list and the renew flow read them.

  revalidatePath("/admin/members");
  revalidatePath("/admin");
  return { written, skippedExisting, errors, branchName: branch.branchName };
}
