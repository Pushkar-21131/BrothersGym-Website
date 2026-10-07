import { cache } from "react";
import { db } from "@/db";
import { branches, trainers } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The branch and trainer rows the public pages render.
 *
 * Shared between the homepage and /plans. Both selects list their columns by
 * hand, and neither reason is obvious enough to survive being written twice:
 *
 *  - The branches table also holds owner_email, upi_id and upi_name — the
 *    owner's private address and the payee VPA his UPI app shows a payer before
 *    they confirm. Nothing here reads them, so nothing leaks today, but select()
 *    pulled all three into a statically cached public render: the day anyone
 *    spreads a branch object into a client component or a JSON-LD block, those
 *    publish with it. Listing exactly what the pages use makes that impossible
 *    rather than merely unlikely, and shrinks the ISR payload.
 *  - photoMime, never photoImage: selecting the base64 would put ~60KB per
 *    trainer into the HTML. The mime is enough to know an uploaded photo exists;
 *    the browser fetches it from /api/trainer-photo/[id]. See resolveTrainerPhoto.
 *
 * Each reader retries once and then throws, matching getPlanPricing and for the
 * same reason. They deliberately do NOT swallow errors and return empty arrays:
 * with revalidate = 3600, an ISR regeneration during a blip would bake "We have
 * 0 branches in Delhi" into the cached HTML and serve that for a full hour. The
 * retry covers a Neon cold start (the free tier scales to zero and the first
 * query after an idle period can time out), so a genuine outage is what throws,
 * not a sleepy database. A failed `next build` is the intended behaviour for a
 * real outage — deploying a page that claims zero branches is worse than not
 * deploying.
 *
 * cache() so a render that reads the same rows twice pays for one query.
 */

export const getPublicBranches = cache(async () => {
  const fetchAll = () =>
    db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        address: branches.address,
        phone: branches.phone,
        ownerName: branches.ownerName,
        // Safe to expose, and already is: /contact renders this as the "Get
        // Directions" href. The homepage needs it for the same job -- the
        // structured data's `hasMap` and `sameAs`, which are how the site entity
        // gets bound to the Google Maps listing for each branch. That binding is
        // what lets an assistant resolve "Brothers Gym, Sagar Pur" to the listing
        // the owner actually controls.
        mapUrl: branches.mapUrl,
      })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.id);

  try {
    return await fetchAll();
  } catch (e) {
    console.error("[public] branch fetch failed, retrying once:", e);
    return await fetchAll();
  }
});

export const getPublicTrainers = cache(async () => {
  const fetchAll = () =>
    db
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
        branchCode: branches.code,
        branchName: branches.name,
      })
      .from(trainers)
      .leftJoin(branches, eq(trainers.branchId, branches.id));

  try {
    return await fetchAll();
  } catch (e) {
    console.error("[public] trainer fetch failed, retrying once:", e);
    return await fetchAll();
  }
});

export type PublicBranch = Awaited<ReturnType<typeof getPublicBranches>>[number];
export type PublicTrainer = Awaited<ReturnType<typeof getPublicTrainers>>[number];

/**
 * ₹ figures that a person reads, grouped the Indian way (1,00,000 — not
 * 100,000). Used for plan and FAQ copy and meta descriptions; the JSON-LD
 * `price` fields stay unformatted, because those are parsed rather than read.
 */
export const inr = (n: number) => new Intl.NumberFormat("en-IN").format(n);
