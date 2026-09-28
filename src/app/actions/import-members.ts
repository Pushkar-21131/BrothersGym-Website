"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";
import { istDateString } from "@/lib/utils";

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
};

export async function importMembersAction(
  rows: ImportMemberRow[],
  targetBranchId?: number
) {
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

  let success = 0;
  const errors: string[] = [];
  const today = istDateString();

  for (const row of rows) {
    try {
      if (
        !row.gymId ||
        !row.name ||
        !row.contactNumber ||
        !row.emergencyContact ||
        !row.feeAmount ||
        !row.membershipExpiry
      ) {
        errors.push(`Skipped invalid row: ${row.name || "Unknown"}`);
        continue;
      }

      const joiningDate = row.joiningDate || today;

      // ===== NO PAYMENT ROW ON IMPORT =====
      // This used to insert a `payments` row for the member's full fee, dated
      // their joining date, right after the member row — two independent
      // statements, so a failure between them left a member with no payment
      // recorded. The row itself was the bigger problem: for a bulk import of
      // existing members that money was collected long ago, often before this
      // system existed, and the row lands in the CURRENT dashboard totals as if
      // it were taken today. The revenue figure the owner makes decisions from
      // was inflated by the whole imported book.
      //
      // The fee and the expiry live on the member row, which is where the members
      // list and the renew flow read them, so nothing needs the payment row.
      // There is now a single write per row, which is why no transaction is
      // needed here either.
      await db.insert(members).values({
        branchId: branch.branchId,
        gymId: Number(row.gymId),
        name: String(row.name),
        email: row.email || null,
        contactNumber: String(row.contactNumber),
        address: row.address || null,
        parentName: row.parentName || null,
        emergencyContact: String(row.emergencyContact),
        feeAmount: Number(row.feeAmount),
        joiningDate,
        membershipExpiry: String(row.membershipExpiry),
        planType: "offline",
      });

      success++;
    } catch (e) {
      errors.push(`${row.name || row.gymId}: ${sanitizeError(e, "failed")}`);
    }
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin");
  return { success, errors, branchName: branch.branchName };
}