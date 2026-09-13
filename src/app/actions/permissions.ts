"use server";

import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { assertCanAdministerUser } from "@/lib/user-admin";
import { sanitizeStaffPermissions } from "@/lib/permissions";
import { sanitizeError } from "@/lib/errors";

/**
 * `permissions` is typed `unknown` on purpose: this is a server action, so the
 * argument is whatever the caller sends and a `StaffPermissions` annotation
 * would be a comment, not a check. sanitizeStaffPermissions rebuilds the blob
 * from PERMISSION_MODULES before it reaches the jsonb column — see the long
 * note there for what a malformed `hiddenFields` does downstream.
 */
export async function updatePermissionsAction(
  userId: number,
  permissions: unknown
) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update permissions." };
  }

  if (!userId || typeof userId !== "number") {
    return { error: "Invalid user" };
  }

  // Role alone is not enough — a branch owner must not be able to widen the
  // other gym's staff permissions, or their own.
  const denied = await assertCanAdministerUser(userId);
  if (denied) return denied;

  try {
    await db
      .update(appUsers)
      .set({ permissions: sanitizeStaffPermissions(permissions) })
      .where(eq(appUsers.id, userId));

    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to save permissions") };
  }
}