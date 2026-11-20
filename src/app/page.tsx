import type { Metadata } from "next";
import { getPlanPricing } from "@/lib/plan-pricing";
import { getPublicBranches, getPublicTrainers, inr } from "@/lib/public-data";
import { getVisibleReviews } from "@/app/actions/reviews";
import Link from "next/link";
import BMICalculator from "./components/bmi-calculator";
import HeroBackground from "./components/hero-background";
import ReviewsSection from "./components/reviews-section";
import TrainersTabs from "./components/trainers-tabs";
import PublicNavbar from "./components/public-navbar";
import PublicFooter from "./components/public-footer";
import FloatingWhatsApp from "./components/floating-whatsapp";
import { Bebas_Neue } from "next/font/google";
import { Dumbbell, UserCircle, Building2, ArrowRight } from "lucide-react";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
});

// Homepage content is public and changes rarely, so the page is statically
// cached (ISR) instead of re-rendered on every visit. The admin actions for
// trainers, reviews, and branches already call revalidatePath("/"), so an edit
// refreshes this cached page on demand; the hourly revalidate is just a
// backstop. (Under the old force-dynamic every visit hit the database and those
// revalidatePath calls did nothing.)
export const revalidate = 3600;

const SITE_URL = "https://brothersgym.in";

/**
 * The branch facts the `branches` table has nowhere to put.
 *
 * A gym branch has a location, opening hours and a set of neighbourhoods it
 * serves. The table has columns for none of the three — it holds an address
 * string, a phone and a map URL — so every coordinate and every opening time in
 * this file used to be a bare literal sitting inline in the JSON-LD. Worse, the
 * two addresses and the two coordinates lived in two *parallel arrays*, which
 * meant nothing in the markup actually said which coordinate belonged to which
 * door. A consumer reading `geo[1]` had only the order of a list to go on.
 *
 * Keyed by branch code so each value is attached to the branch it describes,
 * and so a branch missing from this map degrades to "we don't know this
 * branch's hours" rather than silently inheriting the other gym's.
 *
 * The real fix is columns on `branches` (latitude, longitude, postal code, an
 * hours shape) so an owner can correct his own address without a deploy. That
 * is a migration, and it is deliberately NOT part of this change: it would make
 * the code depend on columns production does not have until someone runs the
 * migration by hand, and a deploy landing before that migration is how the
 * whole site 500s on every page that reads a branch.
 */
type BranchDetail = {
  /** Matches the planned /gym-in-<slug> page, and the JSON-LD `@id` fragment. */
  slug: string;
  latitude: number;
  longitude: number;
  postalCode: string;
  /** Local 24h ranges. A split shift is two entries, which is correct schema. */
  hours: { opens: string; closes: string }[];
  /** Neighbourhoods this door actually serves. Feeds `areaServed`. */
  areaServed: string[];
};

// `| undefined` is not decoration. A branch row can carry any code at all, and
// one that is not in this map must produce "unknown" in the markup rather than
// the other gym's address.
const BRANCH_DETAILS: Record<string, BranchDetail | undefined> = {
  NR: {
    slug: "nangal-raya",
    latitude: 28.6104029,
    longitude: 77.1077599,
    postalCode: "110046",
    hours: [{ opens: "05:30", closes: "22:00" }],
    areaServed: ["Nangal Raya", "Janakpuri", "Vashisht Park", "Sitapuri", "Mohan Nagar"],
  },
  SP: {
    slug: "sagar-pur",
    latitude: 28.6071105,
    longitude: 77.1037377,
    postalCode: "110046",
    hours: [
      { opens: "05:30", closes: "12:00" },
      { opens: "16:00", closes: "22:00" },
    ],
    areaServed: ["Sagar Pur", "Dabri", "Nasirpur", "Mahavir Enclave", "Manglapuri"],
  },
};

/**
 * Both branches are shut on Sunday and the page has always said so — the FAQ
 * answers it directly. The markup did not: it listed Monday to Saturday and
 * omitted Sunday entirely, and an omitted day in `openingHoursSpecification`
 * reads as *unknown*, not *closed*. Google's guidance is that a closed day is
 * declared explicitly as 00:00–00:00, which is what this does.
 */
const CLOSED_SUNDAY = {
  "@type": "OpeningHoursSpecification",
  dayOfWeek: ["Sunday"],
  opens: "00:00",
  closes: "00:00",
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// One parallel round-trip instead of three sequential awaits.
//
// The error posture lives in the readers themselves now: each retries once for
// a Neon cold start and then throws, so a failed ISR regeneration keeps serving
// the last good snapshot rather than caching a page that claims zero branches.
// See public-data.ts.
async function getHomeData() {
  const [allBranches, allTrainers, publicReviews] = await Promise.all([
    getPublicBranches(),
    getPublicTrainers(),
    getVisibleReviews(),
  ]);

  return { allBranches, allTrainers, publicReviews };
}

/**
 * Homepage metadata. The one price claim it makes comes from the database.
 *
 * layout.tsx no longer quotes a figure anywhere — see the note there. The
 * homepage is the page where the number earns its place in a search snippet, and
 * it is also the page that already holds an ISR-cached database read, so this is
 * where it is paid for.
 *
 * openGraph and twitter are respecified in full because Next replaces a parent
 * segment's nested metadata object rather than merging it field by field. The
 * card images are unaffected: they come from src/app/opengraph-image.tsx and
 * twitter-image.tsx, and file-based metadata outranks anything set here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const pricing = await getPlanPricing();
  const from = pricing
    ? `from ₹${inr(pricing.monthlyMin)}/month`
    : "on flexible monthly plans";

  return {
    // Explicit rather than inherited. The root layout no longer declares a
    // canonical -- it used to declare the homepage's, which every other page
    // inherited and de-indexed itself with. With that gone, each page names
    // itself and this is the homepage's turn.
    alternates: { canonical: "/" },
    // 145 characters plus the price clause. It used to run past 215, and the
    // price -- the part that makes this snippet different from every other gym
    // in the area -- sat at the very end, where a truncating engine would drop
    // it. The brand leads so that a search for "brothers gym" gets it bolded.
    description: `Brothers Gym: two gyms in West Delhi — Nangal Raya (Janakpuri) and Sagar Pur. Strength training, cardio and personal coaching. Join ${from}.`,
    openGraph: {
      title: "Brothers Gym | Best Gym in Nangal Raya & Sagar Pur, Delhi",
      description: `Transform your body at Brothers Gym. Expert trainers, modern equipment, affordable memberships ${from}. Two locations in West Delhi.`,
      url: "https://brothersgym.in",
      siteName: "Brothers Gym",
      locale: "en_IN",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Brothers Gym - Best Gym in Delhi",
      description: `Premium fitness center with 2 locations in Delhi. Join ${from}.`,
      creator: "@brothersgym12",
    },
  };
}

export default async function Home() {
  // getPlanPricing was already awaited in generateMetadata, so cache() makes
  // this one free; the Promise.all is for the case where it was not (a future
  // caller, or a Next version that renders the body first).
  const [{ allBranches, allTrainers, publicReviews }, pricing] =
    await Promise.all([getHomeData(), getPlanPricing()]);

  const owners = allTrainers.filter((s) => s.isOwner);
  const gymTrainers = allTrainers.filter((s) => !s.isOwner);
  // NO `aggregateRating` IN THE MARKUP. Deliberate, and it can come back the
  // day there is a real rating to publish.
  //
  // What used to be here averaged the `reviews` table and emitted it as an
  // AggregateRating: 5.0 from 3 reviews. Those three are testimonials the gym
  // collected about itself and typed into the admin panel by hand (see
  // addReviewAction in actions/reviews.ts) -- which makes them "self-serving"
  // under Google's review-snippet policy, and self-serving reviews are
  // ineligible to produce stars for a LocalBusiness. So it was buying nothing,
  // and it was the one piece of markup on the page that asked for something the
  // guidelines say not to ask for.
  //
  // The testimonials stay: they are real members, they are shown further down
  // this page, and they are worth reading. What is gone is the claim to Google
  // that they are a rating. If the gym later embeds its Google reviews from a
  // third party, mark THAT up -- a rating sourced from Google is not
  // self-serving and will show.

  return (
    <div className="public-site min-h-screen bg-zinc-950 font-sans selection:bg-yellow-500 selection:text-black">
      <a href="#main-content" className="public-skip-link">Skip to content</a>
      {/* ============ NAVBAR ============ */}
      {/* The navigation stays legible over the footage and darkens on scroll.
          Its interactive behavior stays outside this Server Component. */}
      <PublicNavbar />

      <main id="main-content" tabIndex={-1}>
      {/* ============ HERO ============ */}
      <section className="relative min-h-[70svh] md:min-h-screen flex items-end pt-20 px-4 md:px-6 border-b border-zinc-800 overflow-hidden">
        <HeroBackground />
        {/* Stronger left fade so text stays readable; logo side stays open */}
        <div className="absolute inset-0 bg-linear-to-r from-black/70 via-black/45 to-black/20"></div>

        <div className="relative max-w-7xl mx-auto w-full pt-16 sm:pt-10 md:pt-12 pb-6 md:pb-8 z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-6 items-center">

            {/* ===== LEFT: redesigned content block ===== */}
            <div className="md:col-span-7 lg:col-span-7 flex flex-col items-start">

              {/* Giant stacked headline — flush left, poster weight */}
              {/* The H1 is the one heading a crawler weights as the page's
                  subject, and it used to read "Two Brothers One Standard" and
                  nothing else -- a slogan carrying a brand fragment and not one
                  word about what the page is, where it is, or what it sells.

                  Both strings are in the DOM; only one is drawn. The slogan
                  keeps the poster composition and is `aria-hidden` because a
                  screen reader announcing "Two Brothers One Standard, Brothers
                  Gym, gym in Nangal Raya..." is reading the same thing twice.
                  The sr-only line is not hidden from crawlers -- it is the
                  accessible-name technique, and the phrase in it is the one the
                  visible page states anyway: both branch names sit below the
                  heading, and both addresses are printed in full under
                  #locations. */}
              <h1
                className={`${bebas.className} w-full text-[clamp(3.25rem,9vw,6rem)] leading-[0.94] tracking-[0.02em] uppercase`}
              >
                <span className="sr-only">
                  Brothers Gym — gym in Nangal Raya (Janakpuri) and Sagar Pur, West Delhi
                </span>
                <span aria-hidden="true" className="block">
                  <span className="text-white">Two</span>{" "}
                  <span className="text-yellow-500">Brothers</span>
                </span>
                <span aria-hidden="true" className="block">
                  <span className="text-white">One</span>{" "}
                  <span className="text-yellow-500">Standard</span>
                </span>
              </h1>

              {/* Gold rule under title */}
              <div className="mt-5 md:mt-6 mb-5 md:mb-6 flex items-center gap-4 w-full max-w-md">
                <div className="h-[3px] w-14 bg-yellow-500 rounded-full"></div>
                <p className="text-zinc-300 text-sm md:text-base leading-relaxed">
                  Same intensity. Same discipline. Two doors in Delhi.
                </p>
              </div>

              <div className="mb-6 space-y-2">
                {pricing && (
                  <p className="text-base sm:text-lg text-white">
                    Memberships from <span className="font-bold text-yellow-500">₹{inr(pricing.monthlyMin)}/month</span>
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-zinc-300">
                  {allBranches.map((branch, index) => (
                    <span key={branch.id} className="inline-flex items-center gap-3">
                      {index > 0 && <span aria-hidden="true" className="text-zinc-400">·</span>}
                      <a href={`#branch-${branch.id}`} className="inline-flex min-h-11 items-center underline decoration-zinc-500 underline-offset-4 hover:text-yellow-500 transition-colors">
                        {branch.name}
                      </a>
                    </span>
                  ))}
                </p>
              </div>

              {/* CTA cluster */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <Link
                  href="/join"
                  className="min-h-11 inline-flex items-center justify-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wide text-xs sm:text-sm px-4 sm:px-5 py-3 rounded-lg transition-colors whitespace-nowrap"
                >
                  Join Now <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a
                  href="#locations"
                  className="min-h-11 inline-flex items-center justify-center border border-zinc-500 hover:border-yellow-500 text-zinc-200 hover:text-yellow-500 font-bold uppercase tracking-wide px-4 sm:px-5 py-3 rounded-lg transition-colors text-xs sm:text-sm whitespace-nowrap"
                >
                  View Locations
                </a>
              </div>

              {/* Bottom meta strip — anchors the block so it doesn’t float */}
              <div className="mt-6 md:mt-8 pt-5 border-t border-zinc-700/80 flex flex-wrap gap-x-6 gap-y-3 text-xs uppercase tracking-wider text-zinc-300">
                <span>Strength</span>
                <span>Cardio</span>
                <span>Personal Training</span>
              </div>
            </div>

            {/* ===== RIGHT: original logo, slightly smaller ===== */}
            {/* Hidden on phones — the navbar already carries the mark, and the
                big circle only pushed the hero content down on a small screen.
                Shows from md up, where there's room beside the headline. */}
            <div className="md:col-span-5 lg:col-span-5 w-full hidden md:flex justify-center md:justify-end">
              <div className="w-full max-w-60 sm:max-w-[280px] md:max-w-[300px] lg:max-w-[340px] relative">
                <div className="aspect-square rounded-full border-4 border-zinc-800 overflow-hidden bg-zinc-900/50 shadow-2xl relative">
                  <img
                    src="/images/brothers-gym-logo.svg"
                    alt="Brothers Gym logo"
                    width={340}
                    height={340}
                    className="w-full h-full object-cover scale-[1.15]"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ============ WHY CHOOSE US ============ */}
      <section id="about" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800 bg-zinc-900/30 relative overflow-hidden">
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center space-y-4 mb-6 md:mb-12">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-white">
              Why Choose <span className="text-yellow-500">Us</span>
            </h2>
            <p className="text-base md:text-lg text-zinc-400 leading-relaxed max-w-3xl mx-auto">
              Founded with a passion for true fitness, Brothers Gym provides top-tier equipment, expert guidance, and an electrifying atmosphere. We believe in raw hard work, dedication, and results.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
            <FeatureCard
              icon={<Dumbbell size={28} aria-hidden="true" />}
              title="Better Equipment"
              description="Machinery carefully selected to optimize your growth and safety."
            />
            <FeatureCard
              icon={<UserCircle size={28} aria-hidden="true" />}
              title="Expert Coaching"
              description="Personalized training programs designed by experienced professionals to hit your goals."
            />
            <FeatureCard
              icon={<Building2 size={28} aria-hidden="true" />}
              title={`${allBranches.length} Locations`}
              description={`Choose from ${allBranches.map((b) => b.name).join(" & ")} — both offer the same quality.`}
            />
          </div>
        </div>
      </section>

      <ReviewsSection reviews={publicReviews} />

      {/* ============ TEAM SECTION ============ */}
      <section id="staff" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-6 md:mb-12">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-white mb-4">
              Meet The <span className="text-yellow-500">Team</span>
            </h2>
            <p className="text-base md:text-lg text-zinc-400 max-w-2xl mx-auto">
              Behind every great transformation is an excellent coach. Get to know the people who will push you past your limits.
            </p>
          </div>

          <TrainersTabs
            branches={allBranches.map((b) => ({
              id: b.id,
              code: b.code,
              name: b.name,
              address: b.address,
            }))}
            trainers={gymTrainers}
            owners={owners}
          />

          {allTrainers.length === 0 && (
            <div className="text-center py-12 text-zinc-400 italic">
              Our team profiles are currently being updated. Check back soon!
            </div>
          )}
        </div>
      </section>

      {/* ============ PLANS & FAQ BAND ============ */}
      {/* The price table and the FAQ used to live here. Both are on /plans now,
          and this band is what the homepage kept: one line that still names a
          real figure in server-rendered prose, so the homepage goes on answering
          "how much is a membership" for a crawler, plus the internal link that
          gets /plans crawled at all. Gated on `pricing` like the table was — with
          no active plans it says nothing about a price. */}
      <section className="py-8 md:py-12 px-4 md:px-6 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 md:gap-6 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-5 md:px-8 md:py-6">
          <div className="text-center sm:text-left">
            <p className="text-white font-bold text-base md:text-lg leading-snug">
              {pricing
                ? `Plans from ₹${inr(pricing.monthlyMin)}/month at both Delhi branches.`
                : "Plans at both Delhi branches."}
            </p>
            <p className="text-zinc-400 text-sm mt-1">
              Full price lists, timings, and the questions we get most.
            </p>
          </div>
          <Link
            href="/plans"
            className="min-h-12 shrink-0 inline-flex items-center justify-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wide text-sm px-5 md:px-6 py-3 rounded-lg transition-colors whitespace-nowrap"
          >
            Plans &amp; FAQ <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <BMICalculator />
      </main>

      {/* ============ FOOTER ============ */}
      <PublicFooter branches={allBranches} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            // A GRAPH, NOT ONE BUSINESS WITH ARRAYS.
            //
            // This was a single HealthClub carrying two addresses, two
            // coordinates and two phone numbers as three *unpaired* arrays, with
            // the opening hours flattened into a fourth on top. Nothing in the
            // markup said which coordinate went with which address, so a
            // consumer had only the order of a list to go on -- and read
            // literally it described one gym, at two addresses, with two phone
            // numbers, open 05:30-22:00 and 05:30-12:00 and 16:00-22:00 at once.
            //
            // Two gyms 400 m apart are not one entity with two addresses. They
            // are two branches of one organisation, which is what
            // Organization.branch models. Google's local guidance wants one
            // entity per physical location, each with its own NAP and hours --
            // which is also exactly what a Google Business Profile is, and
            // matching those listings is the point of this markup.
            //
            // The `@id` fragments let the two nodes state their shared identity
            // once and reference it, instead of repeating it.
            //
            // They are anchors on this page rather than /gym-in-<slug> URLs, and
            // that is deliberate. Google's guidance is that a location entity's
            // @id should be the page describing it -- and those pages do not
            // exist yet. An @id pointing at a URL that 404s is worse than one
            // pointing at an anchor that resolves. When the two branch pages
            // ship, these become `${SITE_URL}/gym-in-<slug>` and the `branch`
            // list above follows them.
            "@graph": [
              {
                "@type": "Organization",
                "@id": `${SITE_URL}/#organization`,
                name: "Brothers Gym",
                url: SITE_URL,
                description:
                  "Premium fitness gym with two locations in Delhi offering strength training, cardio, personal training, and expert coaching.",
                // The PNG, not the SVG that used to be here: `logo` is read by
                // things that rasterise it (knowledge panels, share cards) and
                // an SVG is not reliably accepted. This is the full badge, not
                // the circular favicon crop — at this size the lettering is
                // legible and it is the mark people recognise.
                logo: `${SITE_URL}/images/brothers-gym-logo.png`,
                // The Maps listings first, one per branch. This is the join
                // between the website entity and the Google Business Profile --
                // the thing that actually decides the map pack. The socials are
                // weaker signals and come after.
                sameAs: [
                  ...allBranches
                    .map((b) => b.mapUrl)
                    .filter((u): u is string => Boolean(u)),
                  "https://www.instagram.com/brothersgym12",
                  "https://www.facebook.com/profile.php?id=100063764862295",
                ],
                branch: allBranches.map((b) => ({
                  "@id": `${SITE_URL}/#${BRANCH_DETAILS[b.code]?.slug ?? b.code}`,
                })),
              },
              ...allBranches.map((b) => {
                const detail = BRANCH_DETAILS[b.code];
                const plans = pricing?.plans.filter((p) => p.branchId === b.id) ?? [];
                const prices = plans.map((p) => p.price);
                return {
                  "@type": "HealthClub",
                  "@id": `${SITE_URL}/#${detail?.slug ?? b.code}`,
                  name: `Brothers Gym — ${b.name}`,
                  parentOrganization: { "@id": `${SITE_URL}/#organization` },
                  // No `url` here, and its absence is the honest answer: both
                  // branches used to carry url: SITE_URL, which told a consumer
                  // that two distinct gyms are the same page. Each gets its own
                  // url when its own page exists. The Organization above still
                  // carries the site's.
                  description: `Brothers Gym ${b.name}: strength training, cardio and personal training in West Delhi.`,
                  // One number, this branch's. The deployed markup carried an
                  // SP number that the database and /contact had both since
                  // changed, because it was typed here as a literal. Reading the
                  // row is the fix.
                  telephone: b.phone ?? undefined,
                  address: {
                    "@type": "PostalAddress",
                    streetAddress: b.address,
                    addressLocality: "New Delhi",
                    addressRegion: "Delhi",
                    postalCode: detail?.postalCode,
                    addressCountry: "IN",
                  },
                  geo: detail
                    ? {
                        "@type": "GeoCoordinates",
                        latitude: detail.latitude,
                        longitude: detail.longitude,
                      }
                    : undefined,
                  hasMap: b.mapUrl ?? undefined,
                  // No detail means no hours at all, rather than the other
                  // branch's. An absent openingHoursSpecification is honest; the
                  // wrong one is a lie a searcher acts on by turning up.
                  openingHoursSpecification: detail
                    ? [
                        ...detail.hours.map((h) => ({
                          "@type": "OpeningHoursSpecification",
                          dayOfWeek: WEEKDAYS,
                          opens: h.opens,
                          closes: h.closes,
                        })),
                        CLOSED_SUNDAY,
                      ]
                    : undefined,
                  areaServed: detail?.areaServed.map((name) => ({
                    "@type": "Place",
                    name,
                  })),
                  // Per branch, from that branch's own plans. The old block
                  // quoted one range for the whole site built from every plan,
                  // which priced each gym with the other's cheapest package.
                  priceRange:
                    prices.length > 0
                      ? `₹${inr(Math.min(...prices))} - ₹${inr(Math.max(...prices))}`
                      : undefined,
                  hasOfferCatalog:
                    plans.length > 0
                      ? {
                          "@type": "OfferCatalog",
                          name: `${b.name} Membership Plans`,
                          itemListElement: plans.map((p) => ({
                            "@type": "Offer",
                            name: p.name,
                            price: String(p.price),
                            priceCurrency: "INR",
                            category:
                              p.durationDays <= 31
                                ? "Monthly membership"
                                : `${Math.round(p.durationDays / 30)}-month membership`,
                          })),
                        }
                      : undefined,
                };
              }),
            ],
          }),
        }}
      />

      <FloatingWhatsApp
        branches={allBranches.map((b) => ({
          code: b.code,
          name: b.name,
          ownerName: b.ownerName,
          phone: b.phone,
        }))}
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="border-t border-zinc-700 pt-6 flex items-start gap-4 sm:block">
      <div className="text-yellow-500 shrink-0 sm:mb-4">{icon}</div>
      <div>
        <h3 className="text-lg md:text-xl font-black mb-2 text-white uppercase tracking-wide">
          {title}
        </h3>
        <p className="text-zinc-400 text-base leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
