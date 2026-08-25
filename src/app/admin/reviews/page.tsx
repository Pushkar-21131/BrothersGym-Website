import { db } from "@/db";
import { reviews } from "@/db/schema";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import ReviewsListClient from "./reviews-list-client";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("reviews", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canEdit = role === "owner" || (await hasPermission("reviews", "canEdit"));

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