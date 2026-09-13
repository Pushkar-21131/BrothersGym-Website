"use server";

import { db } from "@/db";
import { members, payments } from "@/db/schema";
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

      const inserted = await db
        .insert(members)
        .values({
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
        })
        .returning();

      if (inserted[0]) {
        await db.insert(payments).values({
          branchId: branch.branchId,
          memberId: inserted[0].id,
          amount: Number(row.feeAmount),
          date: joiningDate,
          method: "cash",
        });
      }
      success++;
    } catch (e) {
      errors.push(`${row.name || row.gymId}: ${sanitizeError(e, "failed")}`);
    }
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin");
  return { success, errors, branchName: branch.branchName };
}