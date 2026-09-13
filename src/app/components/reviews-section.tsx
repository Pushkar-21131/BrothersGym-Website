import type { getVisibleReviews } from "@/app/actions/reviews";
import { Star, Quote, MapPin } from "lucide-react";

/**
 * Roughly how many characters fit in the collapsed 5-line clamp.
 *
 * The card is ~310px wide on a phone and ~350px on desktop at text-sm, so call
 * it ~44 characters a line — five lines is a little over 220. This threshold
 * sits deliberately below that: set it too high and a review clipped by a few
 * words renders with no way to read the rest, which is the exact problem this
 * fixes. Set it too low and a mid-length review shows a control that reveals
 * only a line, which is merely untidy.
 *
 * A character count is an estimate because CSS cannot detect its own overflow.
 * The accurate alternative is measuring scrollHeight in the browser, which would
 * turn this prerendered server component into a client one and ship a JS bundle
 * to toggle a line-clamp. Not worth it for the difference.
 */
const CLAMP_CHAR_ESTIMATE = 200;

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
      className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800 bg-zinc-900/30"
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6 md:mb-12">
          <div className="inline-block border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 rounded-full text-yellow-500 font-bold text-sm tracking-widest uppercase mb-4">
            Real Stories
          </div>
          <h2 className="text-3xl md:text-4xl font-black uppercase tracking-widest text-white mb-4">
            What Our <span className="text-yellow-500">Members Say</span>
          </h2>
          <p className="text-zinc-400 max-w-2xl mx-auto mb-6">
            Don&apos;t just take our word for it. Hear from the champions who train with us every day.
          </p>

          {/* Overall Rating */}
          <div className="inline-flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-full px-6 py-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  size={20}
                  className={
                    star <= Math.round(avgRating)
                      ? "text-yellow-500 fill-yellow-500"
                      : "text-zinc-700"
                  }
                />
              ))}
            </div>
            <span className="text-2xl font-black text-white">{avgRating.toFixed(1)}</span>
            <span className="text-sm text-zinc-500">
              ({reviews.length} {reviews.length === 1 ? "review" : "reviews"})
            </span>
          </div>
        </div>

        {/* Reviews Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-6 hover:border-yellow-500/50 transition-colors relative"
            >
              {/* Quote icon */}
              <div className="absolute -top-3 -left-3 bg-yellow-500 rounded-full p-2">
                <Quote size={16} className="text-black" />
              </div>

              {/* Stars */}
              <div className="flex gap-0.5 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={16}
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
                <div className="mb-6">
                  {/* sr-only rather than hidden: display:none takes the input out
                      of the tab order, which would leave the control reachable
                      by mouse only. */}
                  <input
                    type="checkbox"
                    id={`review-${review.id}-expand`}
                    className="peer sr-only"
                  />
                  <p className="text-zinc-300 text-sm leading-relaxed line-clamp-5 peer-checked:line-clamp-none">
                    &ldquo;{review.reviewText}&rdquo;
                  </p>
                  {/* Two labels instead of one with swapped text: peer-checked:
                      compiles to a sibling selector, so it can only reach
                      elements alongside the input — never a span nested inside
                      a label. */}
                  <label
                    htmlFor={`review-${review.id}-expand`}
                    className="mt-2 inline-block cursor-pointer text-xs font-bold uppercase tracking-wider text-yellow-500 hover:text-yellow-400 peer-checked:hidden peer-focus-visible:underline"
                  >
                    Read more
                  </label>
                  <label
                    htmlFor={`review-${review.id}-expand`}
                    className="mt-2 hidden cursor-pointer text-xs font-bold uppercase tracking-wider text-yellow-500 hover:text-yellow-400 peer-checked:inline-block peer-focus-visible:underline"
                  >
                    Show less
                  </label>
                </div>
              ) : (
                <p className="text-zinc-300 text-sm leading-relaxed mb-6">
                  &ldquo;{review.reviewText}&rdquo;
                </p>
              )}

              {/* Author */}
              <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
                {review.photoUrl ? (
                  <img
                    src={review.photoUrl}
                    alt={review.memberName}
                    loading="lazy"
                    decoding="async"
                    className="w-12 h-12 rounded-full object-cover border-2 border-yellow-500/30"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-linear-to-br from-yellow-500 to-yellow-700 flex items-center justify-center text-black font-black text-lg">
                    {review.memberName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-bold text-white">{review.memberName}</p>
                  {review.memberSince && (
                    <p className="text-xs text-zinc-500">{review.memberSince}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Google Reviews Link */}
        <div className="mt-8 md:mt-10 text-center">
          <a
            href="https://www.google.com/maps/place/Brother'sGym/@28.6121163,77.0901666,15.04z/data=!4m10!1m2!2m1!1sBrother'sGym!3m6!1s0x390d1ddab4ac903b:0x818acf8cf27362ad!8m2!3d28.6104029!4d77.1077599!15sCgxCcm90aGVycyBHeW1aDiIMYnJvdGhlcnMgZ3ltkgEDZ3lt4AEA!16s%2Fg%2F11m48gv1lh?entry=ttu&g_ep=EgoyMDI2MDcwNy4wIKXMDSoASAFQAw%3D%3D"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 hover:border-yellow-500/50 text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            <MapPin size={18} className="text-yellow-500" />
            See More Reviews on Google Maps
          </a>
        </div>
      </div>
    </section>
  );
}