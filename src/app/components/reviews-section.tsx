import type { getVisibleReviews } from "@/app/actions/reviews";
import { Star, MapPin } from "lucide-react";
import ReviewsCarousel from "./reviews-carousel";

// Short reviews stay fully visible. Longer reviews show four lines with an
// explicit expand control; the server renders every review in the carousel.
const CLAMP_CHAR_ESTIMATE = 120;

/**
 * One review row, shaped by the query rather than re-declared here — an
 * `import type` so nothing from the `"use server"` module reaches the runtime.
 */
type Review = Awaited<ReturnType<typeof getVisibleReviews>>[number];

/**
 * REVIEWS ARRIVE AS A PROP; THIS COMPONENT DOES NOT QUERY.
 *
 * It used to call `getVisibleReviews()` itself, while `page.tsx` called the same
 * function for the AggregateRating in its JSON-LD. Two round-trips per render
 * for one list, and — worse — two *independent* reads: the structured data could
 * advertise a rating and a review count computed from a different snapshot than
 * the cards below it, which is the one place a mismatch is machine-readable.
 *
 * The homepage already fetches this inside its single `Promise.all`, so passing
 * it down costs nothing and makes the markup and the cards the same list by
 * construction.
 */
export default function ReviewsSection({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) return null;

  const avgRating =
    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  return (
    <section
      id="reviews"
      className="py-8 md:py-16 px-4 md:px-6 border-b border-zinc-800 bg-zinc-900/30"
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-5 md:mb-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-white mb-4">
            What Our <span className="text-yellow-500">Members Say</span>
          </h2>
          {/* Overall Rating */}
          <div className="inline-flex flex-wrap justify-center items-center gap-2">
            <Star size={16} aria-hidden="true" className="text-yellow-500 fill-yellow-500" />
            <span className="font-bold text-white tabular-nums">{avgRating.toFixed(1)}<span className="sr-only"> out of 5</span></span>
            <span className="text-sm text-zinc-400">
              · {reviews.length} member {reviews.length === 1 ? "review" : "reviews"}
            </span>
          </div>
        </div>

        {/* Reviews Grid */}
        <ReviewsCarousel count={reviews.length}>
          {reviews.map((review, index) => (
            <article
              key={review.id}
              aria-label={`Review ${index + 1} of ${reviews.length}`}
              className="min-w-0 snap-start bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              {/* Stars */}
              <div role="img" className="flex gap-0.5 mb-3" aria-label={`${review.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={16}
                    aria-hidden="true"
                    className={
                      star <= review.rating
                        ? "text-yellow-500 fill-yellow-500"
                        : "text-zinc-700"
                    }
                  />
                ))}
              </div>

              {/* Review text. Long ones expand with a checkbox and peer
                  variants rather than useState: this keeps the section a server
                  component with no client JS at all. The page is prerendered and
                  revalidated hourly, so shipping a bundle just to toggle a
                  line-clamp would be a bad trade. */}
              {review.reviewText.length > CLAMP_CHAR_ESTIMATE ? (
                <div className="mb-3">
                  {/* sr-only rather than hidden: display:none takes the input out
                      of the tab order, which would leave the control reachable
                      by mouse only. */}
                  <input
                    type="checkbox"
                    id={`review-${review.id}-expand`}
                    name={`review-${review.id}-expand`}
                    aria-label={`Read full review from ${review.memberName}`}
                    className="peer sr-only"
                  />
                  <p className="text-zinc-300 text-base leading-relaxed break-words line-clamp-4 peer-checked:line-clamp-none">
                    &ldquo;{review.reviewText}&rdquo;
                  </p>
                  {/* Two labels instead of one with swapped text: peer-checked:
                      compiles to a sibling selector, so it can only reach
                      elements alongside the input — never a span nested inside
                      a label. */}
                  <label
                    htmlFor={`review-${review.id}-expand`}
                    className="mt-2 inline-flex min-h-11 items-center cursor-pointer text-xs font-bold uppercase tracking-wide text-yellow-500 hover:text-yellow-400 peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-yellow-500 peer-focus-visible:outline-offset-4"
                  >
                    Read more
                  </label>
                  <label
                    htmlFor={`review-${review.id}-expand`}
                    className="mt-2 hidden min-h-11 items-center cursor-pointer text-xs font-bold uppercase tracking-wide text-yellow-500 hover:text-yellow-400 peer-checked:inline-flex peer-focus-visible:outline-2 peer-focus-visible:outline-yellow-500 peer-focus-visible:outline-offset-4"
                  >
                    Show less
                  </label>
                </div>
              ) : (
                <p className="text-zinc-300 text-base leading-relaxed break-words mb-3">
                  &ldquo;{review.reviewText}&rdquo;
                </p>
              )}

              {/* Author */}
              <div className="flex items-center gap-3 pt-3 border-t border-zinc-800">
                {review.photoUrl ? (
                  <img
                    src={review.photoUrl}
                    alt={review.memberName}
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    className="w-10 h-10 shrink-0 rounded-full object-cover border-2 border-yellow-500/30"
                  />
                ) : (
                  <div aria-hidden="true" className="w-10 h-10 shrink-0 rounded-full bg-yellow-500 flex items-center justify-center text-black font-black text-lg">
                    {review.memberName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-bold text-white break-words">{review.memberName}</p>
                  {review.memberSince && (
                    <p className="text-xs text-zinc-400">{review.memberSince}</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </ReviewsCarousel>

        {/* Google Reviews Link */}
        <div className="mt-4 md:mt-6 text-center">
          <a
            href="https://www.google.com/maps/place/Brother'sGym/@28.6121163,77.0901666,15.04z/data=!4m10!1m2!2m1!1sBrother'sGym!3m6!1s0x390d1ddab4ac903b:0x818acf8cf27362ad!8m2!3d28.6104029!4d77.1077599!15sCgxCcm90aGVycyBHeW1aDiIMYnJvdGhlcnMgZ3ltkgEDZ3lt4AEA!16s%2Fg%2F11m48gv1lh?entry=ttu&g_ep=EgoyMDI2MDcwNy4wIKXMDSoASAFQAw%3D%3D"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 inline-flex items-center gap-2 border border-zinc-700 hover:border-yellow-500/50 text-zinc-200 font-semibold text-sm px-4 py-3 rounded-lg transition-colors"
          >
            <MapPin size={18} className="text-yellow-500 shrink-0" aria-hidden="true" />
            Reviews on Google Maps
          </a>
        </div>
      </div>
    </section>
  );
}
