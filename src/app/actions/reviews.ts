"use server";

import { db } from "@/db";
import { reviews } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sanitizeError } from "@/lib/errors";
import { assertBrandContentAccess } from "@/lib/branch";

/**
 * NOTE ON SCOPING
 * Homepage testimonials are deliberately NOT branch-scoped: there is one public
 * website for both gyms, so they are one shared pool (reviews.branchId exists in
 * the schema but has never been written or read). Because the pool is shared, it
 * is curated by a single account rather than by both owners — otherwise either
 * owner could delete a review praising the other's gym. See
 * canManageBrandContent() in lib/branch.ts for who that is.
 */

// ===== PUBLIC — for landing page (no auth) =====
export async function getVisibleReviews() {
  try {
    return await db
      .select()
      .from(reviews)
      .where(eq(reviews.isVisible, true))
      .orderBy(reviews.displayOrder, desc(reviews.createdAt));
  } catch {
    return [];
  }
}

// ===== ADD REVIEW =====
export async function addReviewAction(formData: FormData) {
  try {
    await assertBrandContentAccess();
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to add reviews") };
  }

  const memberName = (formData.get("memberName") as string)?.trim();
  const rating = parseInt(formData.get("rating") as string);
  const reviewText = (formData.get("reviewText") as string)?.trim();
  const memberSince = ((formData.get("memberSince") as string) || "").trim();
  const photoUrl = ((formData.get("photoUrl") as string) || "").trim();
  const displayOrder = parseInt(formData.get("displayOrder") as string) || 0;

  if (!memberName || !rating || !reviewText) {
    return { error: "Please fill all required fields" };
  }

  try {
    await db.insert(reviews).values({
      memberName,
      rating,
      reviewText,
      memberSince: memberSince || null,
      photoUrl: photoUrl || null,
      isVisible: true,
      displayOrder,
    });

    revalidatePath("/admin/reviews");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to add review") };
  }
}

// ===== UPDATE REVIEW =====
export async function updateReviewAction(id: number, formData: FormData) {
  try {
    await assertBrandContentAccess();
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to edit reviews") };
  }

  const memberName = (formData.get("memberName") as string)?.trim();
  const rating = parseInt(formData.get("rating") as string);
  const reviewText = (formData.get("reviewText") as string)?.trim();
  const memberSince = ((formData.get("memberSince") as string) || "").trim();
  const photoUrl = ((formData.get("photoUrl") as string) || "").trim();
  const displayOrder = parseInt(formData.get("displayOrder") as string) || 0;
  const isVisible = formData.get("isVisible") === "true";

  if (!memberName || !rating || !reviewText) {
    return { error: "Please fill all required fields" };
  }

  try {
    await db
      .update(reviews)
      .set({
        memberName,
        rating,
        reviewText,
        memberSince: memberSince || null,
        photoUrl: photoUrl || null,
        displayOrder,
        isVisible,
      })
      .where(eq(reviews.id, id));

    revalidatePath("/admin/reviews");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to update review") };
  }
}

// ===== DELETE REVIEW =====
export async function deleteReviewAction(id: number) {
  try {
    await assertBrandContentAccess();
  } catch (e) {
    return { error: sanitizeError(e, "Not authorized to delete reviews") };
  }

  try {
    await db.delete(reviews).where(eq(reviews.id, id));
    revalidatePath("/admin/reviews");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { error: sanitizeError(e, "Failed to delete review") };
  }
}