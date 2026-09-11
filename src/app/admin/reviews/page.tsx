import { db } from "@/db";
import { reviews } from "@/db/schema";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import ReviewsListClient from "./reviews-list-client";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";
import { canManageBrandContent, isBrandContentBranch } from "@/lib/branch";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  // Homepage testimonials are one shared pool for one shared public website, so
  // they are curated by a single account rather than by both owners — otherwise
  // either owner could delete a review praising the other's gym. The same gate
  // guards the write actions in actions/reviews.ts.
  //
  // Staff keep both of their existing grants (canView = read-only, canEdit =
  // full) but only inside the curating branch.
  const canEdit = await canManageBrandContent();
  const canView =
    canEdit ||
    ((await isBrandContentBranch()) &&
      (await hasPermission("reviews", "canView")));
  if (!canView) redirect("/admin/members");

  const allReviews = await db
    .select()
    .from(reviews)
    .orderBy(desc(reviews.createdAt));

  const visibleCount = allReviews.filter((r) => r.isVisible).length;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Reviews</h1>
        <p className="adm-sub">
          <strong>{visibleCount} live</strong> on the homepage · {allReviews.length}{" "}
          total
        </p>
      </div>
      <ReviewsListClient initialReviews={allReviews} canEdit={canEdit} />
    </>
  );
}