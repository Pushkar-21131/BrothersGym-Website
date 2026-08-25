"use server";

import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { sanitizeError } from "@/lib/errors";
import { logAuditEvent } from "@/lib/audit";

// ===== UPDATE BRANCH INFO =====
export async function updateBranchAction(id: number, formData: FormData) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update branch info." };
  }

  const name = String(formData.get("name") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const ownerName = String(formData.get("ownerName") || "").trim();
  const ownerEmail = String(formData.get("ownerEmail") || "").trim().toLowerCase();
  const mapUrl = String(formData.get("mapUrl") || "").trim(); 
  const isActive = formData.get("isActive") === "true";

  if (!name || !address) {
    return { error: "Branch name and address are required." };
  }

  try {
    await db
      .update(branches)
      .set({
        name,
        address,
        phone: phone || null,
        ownerName: ownerName || null,
        ownerEmail: ownerEmail || null,
        mapUrl: mapUrl || null, 
        isActive,
      })
      .where(eq(branches.id, id));

    await logAuditEvent("branch.updated", `Updated branch ${name}`);

    revalidatePath("/admin/branch");
    revalidatePath("/");
    revalidatePath("/contact");
    revalidatePath("/privacy");
    revalidatePath("/terms");
    revalidatePath("/refund");
    revalidatePath("/join");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to update branch") };
  }
}