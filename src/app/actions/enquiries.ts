"use server";

import { db } from "@/db";
import { enquiries, EnquiryStatus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertBranchInScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { istDateString } from "@/lib/utils";
import {
  assertAuthenticated,
  assertPermission,
  getCurrentUser,
  hasPermission,
} from "@/lib/auth-check";
import type { ImportEnquiryRow } from "@/lib/enquiry-parse";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<string>(["new", "follow_up", "joined", "lost"]);
/** Unrecognised status falls back to "new" rather than reaching the column. */
const statusOf = (v: unknown): EnquiryStatus =>
  typeof v === "string" && STATUSES.has(v) ? (v as EnquiryStatus) : "new";

/** A `date` column rejects anything that is not `YYYY-MM-DD`, and one bad value
 *  would take the whole multi-row insert down with it. */
const dateOrNull = (v: unknown) => {
  const s = String(v ?? "").trim();
  return ISO_DATE.test(s) ? s : null;
};

async function assertEnquiryAccess(action: string) {
  const role = await assertAuthenticated();
  if (role !== "owner") await assertPermission("enquiries", action);
}

/**
 * Every action that touches an existing row goes through this.
 *
 * An account without `canView` is in add-only mode: its page shows back only
 * what it wrote, so every id it can name is its own. Enforced here rather than
 * in the list alone, because the edit sheet takes an id and a tampered payload
 * does not go through the list at all.
 */
async function loadEnquiryInScope(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await db.select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
  if (rows.length === 0) return null;
  try {
    await assertBranchInScope(rows[0].branchId, "enquiry");
  } catch {
    // Same answer as "not found", so ids cannot be probed across branches.
    return null;
  }
  if (!(await hasPermission("enquiries", "canView"))) {
    const user = await getCurrentUser();
    // Same answer again, for the same reason: not yours reads as not there.
    if (!user?.id || rows[0].createdByUserId !== user.id) return null;
  }
  return rows[0];
}

function revalidate() {
  revalidatePath("/admin/enquiries");
  // The nav badge lives in the layout, so it needs its own invalidation.
  revalidatePath("/admin", "layout");
}

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim() || null,
    sex: String(formData.get("sex") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
    inquiryDate: dateOrNull(formData.get("inquiryDate")),
    followUpDate: dateOrNull(formData.get("followUpDate")),
    branchId: formData.get("branchId") ? Number(formData.get("branchId")) : undefined,
  };
}

// ===== ADD =====
export async function addEnquiryAction(formData: FormData) {
  try {
    await assertEnquiryAccess("canAdd");
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add enquiries") };
  }

  const f = readForm(formData);
  if (!f.name) return { error: "Please enter a name" };
  // Only these three are real values; anything else is stored as null.
  const sex = ["male", "female", "other"].includes(f.sex ?? "")
    ? (f.sex as "male" | "female" | "other")
    : null;

  try {
    const branch = await requireSingleBranch(f.branchId);
    const user = await getCurrentUser();
    await db.insert(enquiries).values({
      branchId: branch.branchId,
      name: f.name,
      phone: f.phone,
      sex,
      note: f.note,
      inquiryDate: f.inquiryDate || istDateString(),
      followUpDate: f.followUpDate,
      // null for the env-based owner, which has no app_users row. Stored as
      // null rather than assumed away — see the columns' note in schema.ts.
      createdByUserId: user?.id ?? null,
      createdByName: user?.name ?? null,
    });

    revalidate();
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add enquiry") };
  }
}

// ===== UPDATE =====
export async function updateEnquiryAction(id: number, formData: FormData) {
  try {
    await assertEnquiryAccess("canEdit");
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit enquiries") };
  }

  const existing = await loadEnquiryInScope(id);
  if (!existing) return { error: "Enquiry not found" };

  const f = readForm(formData);
  if (!f.name) return { error: "Please enter a name" };
  const sex = ["male", "female", "other"].includes(f.sex ?? "")
    ? (f.sex as "male" | "female" | "other")
    : null;

  try {
    await db
      .update(enquiries)
      .set({
        name: f.name,
        phone: f.phone,
        sex,
        note: f.note,
        inquiryDate: f.inquiryDate || existing.inquiryDate,
        followUpDate: f.followUpDate,
        status: statusOf(formData.get("status") ?? existing.status),
      })
      .where(eq(enquiries.id, id));

    revalidate();
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update enquiry") };
  }
}

// ===== DELETE =====
export async function deleteEnquiryAction(id: number) {
  try {
    await assertEnquiryAccess("canDelete");
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete enquiries") };
  }

  const existing = await loadEnquiryInScope(id);
  if (!existing) return { error: "Enquiry not found" };

  try {
    await db.delete(enquiries).where(eq(enquiries.id, id));
    revalidate();
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete enquiry") };
  }
}

// ===== STATUS =====
/**
 * Moves an enquiry between new / follow_up / joined / lost.
 *
 * `convertedMemberId` is set only on the path that actually creates a member,
 * so the "joined" rows carry a link back to who they became.
 */
export async function markEnquiryStatusAction(
  id: number,
  status: EnquiryStatus,
  convertedMemberId?: number
) {
  try {
    await assertEnquiryAccess("canEdit");
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit enquiries") };
  }

  if (!STATUSES.has(status)) return { error: "Unknown status" };

  const existing = await loadEnquiryInScope(id);
  if (!existing) return { error: "Enquiry not found" };

  try {
    await db
      .update(enquiries)
      .set({
        status,
        ...(convertedMemberId && Number.isInteger(convertedMemberId)
          ? { convertedMemberId }
          : {}),
      })
      .where(eq(enquiries.id, id));

    revalidate();
    revalidatePath("/admin/members");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update status") };
  }
}

// ===== LOG A CONTACT =====
/**
 * Called after the owner opens WhatsApp, so a card can show how many times this
 * person has been approached and when. Best-effort: it reports nothing back, and
 * a failure here must not surface as an error on a message that did go out.
 */
export async function logEnquiryContactAction(id: number) {
  try {
    await assertEnquiryAccess("canSendWhatsApp");
  } catch {
    return { error: "Not authorized" };
  }

  const existing = await loadEnquiryInScope(id);
  if (!existing) return { error: "Enquiry not found" };

  try {
    await db
      .update(enquiries)
      .set({
        contactCount: existing.contactCount + 1,
        lastContactedAt: new Date(),
      })
      .where(eq(enquiries.id, id));

    revalidatePath("/admin/enquiries");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to log contact") };
  }
}

// ===== PREFILL (enquiry → Add Member) =====
export async function getEnquiryForPrefill(id: number) {
  try {
    await assertEnquiryAccess("canView");
  } catch {
    return { error: "Not authorized" };
  }

  const existing = await loadEnquiryInScope(id);
  if (!existing) return { error: "Enquiry not found" };

  // Sex comes along as well: it was typed when the person first walked in, and
  // the Add Member form should not ask for it a second time.
  return { name: existing.name, phone: existing.phone ?? "", sex: existing.sex };
}

// ===== IMPORT =====
type EnquiryInsert = typeof enquiries.$inferInsert;

// One statement per chunk: a round trip to this Neon instance is ~78ms, and the
// Netlify function limit is 10s — see the note in import-members.ts.
const INSERT_CHUNK = 250;

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function toInsertValues(
  row: ImportEnquiryRow,
  branchId: number,
  today: string,
  creator: { id: number | null; name: string | null }
): EnquiryInsert {
  return {
    branchId,
    name: String(row.name).trim(),
    phone: String(row.phone ?? "").trim() || null,
    sex: row.sex ?? null,
    note: String(row.note ?? "").trim() || null,
    inquiryDate: ISO_DATE.test(String(row.inquiryDate ?? ""))
      ? String(row.inquiryDate)
      : today,
    // A whole sheet carries one author, and stamping it keeps the owner's
    // creator filter honest about where a row came from.
    createdByUserId: creator.id,
    createdByName: creator.name,
  };
}

export type ImportEnquiryOutcome =
  | { error: string }
  | {
      written: number;
      skippedExisting: number;
      failed: number;
      failedRows: string[];
      branchName: string;
    };

/**
 * Retries a chunk by halving it. A multi-row INSERT is atomic, so ONE value
 * Postgres will not take would otherwise lose the other 249 rows with it — and
 * this list came off paper, so a lost row is a name that has to be found again.
 * Halving names the culprit in about 2·log₂(n) round trips.
 */
async function insertIsolating(
  chunk: EnquiryInsert[],
  failedRows: string[]
): Promise<{ written: number; failed: number }> {
  try {
    const inserted = await db
      .insert(enquiries)
      .values(chunk)
      .returning({ id: enquiries.id });
    return { written: inserted.length, failed: 0 };
  } catch (e) {
    if (chunk.length === 1) {
      if (failedRows.length < 8) {
        failedRows.push(`${chunk[0].name}: ${sanitizeError(e, "could not be read")}`);
      }
      return { written: 0, failed: 1 };
    }

    const mid = Math.ceil(chunk.length / 2);
    const halves = await Promise.all([
      insertIsolating(chunk.slice(0, mid), failedRows),
      insertIsolating(chunk.slice(mid), failedRows),
    ]);
    return {
      written: halves[0].written + halves[1].written,
      failed: halves[0].failed + halves[1].failed,
    };
  }
}

export async function importEnquiriesAction(
  rows: ImportEnquiryRow[],
  targetBranchId?: number
): Promise<ImportEnquiryOutcome> {
  try {
    await assertEnquiryAccess("canAdd");
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to import enquiries") };
  }

  // Add-only is not enough for a bulk import. The importer dedupes against every
  // enquiry in the branch and answers with a skip count, so running one is a way
  // to ask questions about a list this account may not read — and the rows it
  // writes would be its own, in a register it cannot browse back. Same reason
  // Members has no add-only mode.
  if (!(await hasPermission("enquiries", "canView"))) {
    return { error: "Not authorized to import enquiries" };
  }

  if (!rows?.length) return { error: "No rows to import" };

  let branch;
  try {
    branch = await requireSingleBranch(targetBranchId);
  } catch (e) {
    return { error: sanitizeError(e, "Please select a branch to import into") };
  }

  const today = istDateString();
  const failedRows: string[] = [];

  try {
    // Nothing in this sheet is a real key, so a re-run is guarded by loading
    // what the branch already has and matching on name + phone. One query, not
    // one per row, for the same wall-clock reason as the chunked insert.
    const existing = await db
      .select({ name: enquiries.name, phone: enquiries.phone })
      .from(enquiries)
      .where(eq(enquiries.branchId, branch.branchId));

    const seen = new Set(
      existing.map((e) => `${e.name.trim().toLowerCase()}|${digits(e.phone)}`)
    );

    const pending: EnquiryInsert[] = [];
    let skippedExisting = 0;
    const importer = await getCurrentUser();
    const creator = { id: importer?.id ?? null, name: importer?.name ?? null };
    for (const row of rows) {
      if (!String(row.name ?? "").trim()) continue;
      const key = `${String(row.name).trim().toLowerCase()}|${digits(row.phone)}`;
      if (seen.has(key)) {
        skippedExisting++;
        continue;
      }
      seen.add(key);
      pending.push(toInsertValues(row, branch.branchId, today, creator));
    }

    let written = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
      const result = await insertIsolating(
        pending.slice(i, i + INSERT_CHUNK),
        failedRows
      );
      written += result.written;
      failed += result.failed;
    }

    revalidate();
    return {
      written,
      skippedExisting,
      failed,
      failedRows,
      branchName: branch.branchName,
    };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to import enquiries") };
  }
}
