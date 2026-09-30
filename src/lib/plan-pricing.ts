import { cache } from "react";
import { db } from "@/db";
import { membershipPlans } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Live prices, read from the membership_plans rows the join page sells from and
 * the owner edits in the admin panel.
 *
 * Every price the site quotes comes from here — the homepage's metadata, its
 * FAQ answers, its offer catalog, the JSON-LD priceRange, and the social share
 * card. Five places on this site used to quote a price from memory, and no two
 * of them agreed: priceRange said "₹900 - ₹14000", the offer catalog said 1500
 * and 1200, the FAQ markup said "₹900 to ₹1500", and layout.tsx said "from ₹900"
 * three times. None of them was still true — the cheapest plan is now ₹1000 —
 * because nobody edits a meta tag when they change a price in the admin panel.
 * Deriving them removes that whole class of staleness.
 *
 * This lives in its own module rather than inside the homepage because the
 * social card needs the same figure, and a second copy of this query is exactly
 * how the drift above started. One reader, one answer.
 *
 * cache() so the page body and generateMetadata share one query per render.
 *
 * The retry-then-throw matches getHomeData in page.tsx, and for the same reason:
 * a Neon cold start should not fail the build, but a genuine outage must throw
 * so ISR keeps serving the last good snapshot instead of baking a priceless page
 * into the cache for an hour. Callers that must not fail — the social card —
 * catch it themselves and fall back to copy naming no figure.
 */

export type PricedPlan = {
  branchId: number;
  name: string;
  price: number;
  durationDays: number;
  // Read as a column, never inferred from `name`. The homepage groups its price
  // table by tier, and the tier is the difference between two plans of the same
  // duration — the one thing a name-parsing bug would get silently backwards.
  includesCardio: boolean;
};

export type PlanPricing = {
  plans: PricedPlan[];
  min: number;
  max: number;
  monthlyMin: number;
};

export const getPlanPricing = cache(async (): Promise<PlanPricing | null> => {
  const fetchPlans = () =>
    db
      .select({
        branchId: membershipPlans.branchId,
        name: membershipPlans.name,
        price: membershipPlans.price,
        durationDays: membershipPlans.durationDays,
        includesCardio: membershipPlans.includesCardio,
      })
      .from(membershipPlans)
      .where(eq(membershipPlans.isActive, true))
      .orderBy(membershipPlans.branchId, membershipPlans.displayOrder);

  let plans;
  try {
    plans = await fetchPlans();
  } catch (e) {
    console.error("[Home] plan pricing failed, retrying once:", e);
    plans = await fetchPlans();
  }

  // A gym with no active plans is a real state — a new branch mid-setup — and
  // every caller falls back to copy that names no figure at all. Quoting
  // "from ₹0" would be worse than quoting nothing.
  const priced = plans.filter((p) => p.price > 0);
  if (priced.length === 0) return null;

  const prices = priced.map((p) => p.price);
  // "From ₹X/month" has to mean a monthly plan. Without this filter the minimum
  // would happily be a 12-month plan's total, which is a much bigger number and
  // not a monthly fee.
  const monthly = priced.filter((p) => p.durationDays <= 31).map((p) => p.price);

  return {
    plans: priced,
    min: Math.min(...prices),
    max: Math.max(...prices),
    monthlyMin: monthly.length > 0 ? Math.min(...monthly) : Math.min(...prices),
  };
});
