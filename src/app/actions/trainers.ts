"use server";

import { db } from "@/db";
import { trainers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getBranchScope, requireSingleBranch } from "@/lib/branch";
import { sanitizeError } from "@/lib/errors";
import { assertAuthenticated, assertPermission } from "@/lib/auth-check";
import { validatePhotoImage } from "@/lib/trainer-photo";

/**
 * Pull an uploaded photo out of the form, if one was chosen.
 *
 * Three outcomes, and the middle one is why this returns a discriminated shape
 * rather than just a string: "no photo field submitted" has to mean LEAVE THE
 * EXISTING PHOTO ALONE, which is different from "the owner asked to remove it".
 * Collapsing those two would wipe a trainer's photo every time someone edited
 * their PT fee.
 */
type PhotoIntent =
  | { kind: "unchanged" }
  | { kind: "clear" }
  | { kind: "set"; base64: string; mime: string }
  | { kind: "error"; error: string };

function readPhotoIntent(formData: FormData): PhotoIntent {
  if (formData.get("removePhoto") === "true") return { kind: "clear" };

  const raw = ((formData.get("photoData") as string) || "").trim();
  if (!raw) return { kind: "unchanged" };

  const v = validatePhotoImage(raw);
  if (!v.ok) return { kind: "error", error: v.error };
  return { kind: "set", base64: v.base64, mime: v.mime };
}

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
      // Explicit column list, not select(): a bare select() would pull photoImage,
      // which is ~60KB of base64 per trainer, into a list that only needs to know
      // whether a photo exists. photoMime answers that.
      .select({
        id: trainers.id,
        branchId: trainers.branchId,
        name: trainers.name,
        photoUrl: trainers.photoUrl,
        photoMime: trainers.photoMime,
        experience: trainers.experience,
        ptFee: trainers.ptFee,
        isOwner: trainers.isOwner,
        instagramUrl: trainers.instagramUrl,
        createdAt: trainers.createdAt,
      })
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
    // Same reason as above, and it matters more here: this feeds the public site,
    // so a bare select() would put every trainer's base64 into the HTML of the
    // most-visited page. The browser fetches /api/trainer-photo/[id] instead.
    return await db
      .select({
        id: trainers.id,
        branchId: trainers.branchId,
        name: trainers.name,
        photoUrl: trainers.photoUrl,
        photoMime: trainers.photoMime,
        experience: trainers.experience,
        ptFee: trainers.ptFee,
        isOwner: trainers.isOwner,
        instagramUrl: trainers.instagramUrl,
        createdAt: trainers.createdAt,
      })
      .from(trainers);
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

  const photo = readPhotoIntent(formData);
  if (photo.kind === "error") return { error: photo.error };

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
      // "unchanged" and "clear" are both just "no photo" on an insert — there is
      // no existing row to preserve or wipe.
      photoImage: photo.kind === "set" ? photo.base64 : null,
      photoMime: photo.kind === "set" ? photo.mime : null,
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

  const photo = readPhotoIntent(formData);
  if (photo.kind === "error") return { error: photo.error };

  try {
    const scope = await getBranchScope();
    // Column list rather than select(): the access check below only needs
    // branchId, and a bare select() would read this trainer's ~60KB photo just to
    // throw it away.
    const existing = await db
      .select({ branchId: trainers.branchId })
      .from(trainers)
      .where(eq(trainers.id, id))
      .limit(1);
    if (existing.length === 0) return { error: "Trainer not found" };

    const canAccess =
      scope.type === "all"
        ? scope.branchIds.includes(existing[0].branchId)
        : scope.branchId === existing[0].branchId;
    if (!canAccess) return { error: "You don't have access to this trainer" };

    await db
      .update(trainers)
      .set({
        name,
        experience,
        ptFee,
        isOwner,
        photoUrl,
        instagramUrl,
        // Spread so the photo columns are absent from the SET clause entirely when
        // nothing about the photo changed. Writing `undefined` would be the same
        // to drizzle, but being explicit here is what stops a future edit from
        // "tidying" this into `photoImage: photo.base64 ?? null` and silently
        // clearing every trainer's photo on an unrelated save.
        ...(photo.kind === "set"
          ? { photoImage: photo.base64, photoMime: photo.mime }
          : photo.kind === "clear"
            ? { photoImage: null, photoMime: null }
            : {}),
      })
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
    // Column list rather than select(): the access check below only needs
    // branchId, and a bare select() would read this trainer's ~60KB photo just to
    // throw it away.
    const existing = await db
      .select({ branchId: trainers.branchId })
      .from(trainers)
      .where(eq(trainers.id, id))
      .limit(1);
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