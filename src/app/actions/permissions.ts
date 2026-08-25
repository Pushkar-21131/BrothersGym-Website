"use server";

import { db } from "@/db";
import { appUsers } from "@/db/schema";
import type { StaffPermissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { sanitizeError } from "@/lib/errors";

export async function updatePermissionsAction(
  userId: number,
  permissions: StaffPermissions
) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update permissions." };
  }

  if (!userId || typeof userId !== "number") {
    return { error: "Invalid user" };
  }

  try {
    await db
      .update(appUsers)
      .set({ permissions })
      .where(eq(appUsers.id, userId));

    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to save permissions") };
  }
}