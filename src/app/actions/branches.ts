"use server";

import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth-check";
import { isBranchInScope, isSuperAdmin } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { logAuditEvent } from "@/lib/audit";

// ===== UPDATE BRANCH INFO =====
export async function updateBranchAction(id: number, formData: FormData) {
  try {
    await assertOwner();
  } catch {
    return { error: "Only the owner can update branch info." };
  }

  // Each gym's own details — address, phone, map link, payee name — belong to
  // that gym's owner. Without this check an owner could rewrite the OTHER
  // branch's public contact details and payment identity by id.
  if (!Number.isInteger(id) || id <= 0 || !(await isBranchInScope(id))) {
    return { error: "Branch not found." };
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

  // Deactivating a branch hides it from getAllBranches(), which would lock a
  // branch-scoped owner out of their own dashboard on the next request. Only the
  // super-admin, who is never scoped to a branch, can flip it.
  const mayToggleActive = await isSuperAdmin();

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
        // upiId / upiName are deliberately NOT in this update. The edit form no
        // longer has those inputs (nothing reads them since the QR pay screen was
        // deleted — online payments settle into the branch's Razorpay account),
        // and leaving them here would be worse than dead code: formData.get on a
        // field that isn't submitted returns null, so every branch save would
        // quietly wipe whatever the columns held. Omitting them leaves the stored
        // values untouched, which is what "we stopped using this" should mean.
        ...(mayToggleActive ? { isActive } : {}),
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