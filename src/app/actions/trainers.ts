"use server";

import { db } from "@/db";
import { trainers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";

// ===== LIST TRAINERS (admin) =====
export async function listTrainersForAdmin() {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("trainers", "canView");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized") };
  }

  try {
    const scope = await getBranchScope();
    const rows = await db
      .select()
      .from(trainers)
      .where(
        scope.type === "single"
          ? eq(trainers.branchId, scope.branchId)
          : inArray(trainers.branchId, scope.branchIds)
      );
    return { success: true, trainers: rows };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to load trainers") };
  }
}

// PUBLIC — no auth needed for landing page
export async function listPublicTrainers() {
  try {
    return await db.select().from(trainers);
  } catch {
    return [];
  }
}

// ===== ADD TRAINER =====
export async function addTrainerAction(formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("trainers", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add trainers") };
  }

  const name = (formData.get("name") as string)?.trim();
  const experience = (formData.get("experience") as string)?.trim();
  const ptFee = parseInt(formData.get("ptFee") as string);
  const isOwner = formData.get("isOwner") === "true";
  const photoUrl = ((formData.get("photoUrl") as string) || "").trim() || null;
  const instagramUrl =
    ((formData.get("instagramUrl") as string) || "").trim() || null;
  const formBranchId = formData.get("branchId")
    ? Number(formData.get("branchId"))
    : undefined;

  if (!name || !experience || isNaN(ptFee)) {
    return { error: "Please fill all required fields" };
  }

  try {
    const branch = await requireSingleBranch(formBranchId);

    await db.insert(trainers).values({
      branchId: branch.branchId,
      name,
      experience,
      ptFee,
      isOwner,
      photoUrl,
      instagramUrl,
    });

    revalidatePath("/admin/trainers");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to add trainer") };
  }
}

// ===== UPDATE TRAINER =====
export async function updateTrainerAction(id: number, formData: FormData) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("trainers", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit trainers") };
  }

  const name = (formData.get("name") as string)?.trim();
  const experience = (formData.get("experience") as string)?.trim();
  const ptFee = parseInt(formData.get("ptFee") as string);
  const isOwner = formData.get("isOwner") === "true";
  const photoUrl = ((formData.get("photoUrl") as string) || "").trim() || null;
  const instagramUrl =
    ((formData.get("instagramUrl") as string) || "").trim() || null;

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(trainers).where(eq(trainers.id, id)).limit(1);
    if (existing.length === 0) return { error: "Trainer not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this trainer" };

    await db
      .update(trainers)
      .set({ name, experience, ptFee, isOwner, photoUrl, instagramUrl })
      .where(eq(trainers.id, id));

    revalidatePath("/admin/trainers");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to update trainer") };
  }
}

// ===== DELETE TRAINER =====
export async function deleteTrainerAction(id: number) {
  try {
    const role = await assertAuthenticated();
    if (role !== "owner") {
      await assertPermission("trainers", "canEdit");
    }
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete trainers") };
  }

  try {
    const scope = await getBranchScope();
    const existing = await db.select().from(trainers).where(eq(trainers.id, id)).limit(1);
    if (existing.length === 0) return { error: "Trainer not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this trainer" };

    await db.delete(trainers).where(eq(trainers.id, id));

    revalidatePath("/admin/trainers");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    return { error: sanitizeError(error, "Failed to delete trainer") };
  }
}