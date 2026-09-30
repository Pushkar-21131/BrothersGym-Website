import type { Metadata } from "next";
import { db } from "@/db";
import { trainers, branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPlanPricing } from "@/lib/plan-pricing";
import { getVisibleReviews } from "@/app/actions/reviews";
import Link from "next/link";
import BMICalculator from "./components/bmi-calculator";
import HeroBackground from "./components/hero-background";
import ReviewsSection from "./components/reviews-section";
import TrainersTabs from "./components/trainers-tabs";
import PublicNavbar from "./components/public-navbar";
import FloatingWhatsApp from "./components/floating-whatsapp";
import { Bebas_Neue } from "next/font/google";
import {
  Dumbbell,
  UserCircle,
  MapPin,
  Phone,
  Building2,
  ArrowRight,
  Clock,
  HelpCircle,
} from "lucide-react";

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
// This deliberately does NOT swallow database errors. It used to return empty
// arrays on failure, which looked safe but was worse: with revalidate = 3600,
// an ISR regeneration during a blip would bake "Now at 0 locations" and "We
// have 0 branches in Delhi" into the cached HTML and serve that for a full
// hour. Throwing instead makes Next keep serving the last good snapshot.
//
// The one retry covers a Neon cold start (the free tier scales to zero and the
// first query after an idle period can time out), so a genuine outage is what
// throws, not a sleepy database. A failed `next build` is the intended
// behaviour for a real outage — deploying a page that claims zero branches is
// worse than not deploying.
async function getHomeData() {
  const fetchAll = () =>
    Promise.all([
      // Named columns, not select(). The branches table also holds owner_email,
      // upi_id and upi_name — the owner's private address and the payee VPA his
      // UPI app shows a payer before they confirm. Nothing on this page reads
      // them, so nothing leaks today, but select() pulled all three into a
      // statically cached public render: the day anyone spreads a branch object
      // into a client component or a JSON-LD block, those publish with it.
      //
      // Listing exactly what the page uses makes that impossible rather than
      // merely unlikely, and it shrinks the ISR payload on the most-visited page.
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
          // structured data's `hasMap` and `sameAs`, which are how the site
          // entity gets bound to the Google Maps listing for each branch. That
          // binding is what lets an assistant resolve "Brothers Gym, Sagar Pur"
          // to the listing the owner actually controls.
          mapUrl: branches.mapUrl,
        })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(branches.id),
      db
        .select({
          id: trainers.id,
          branchId: trainers.branchId,
          name: trainers.name,
          photoUrl: trainers.photoUrl,
          // photoMime, never photoImage: this is the homepage, and selecting the
          // base64 would put ~60KB per trainer into its HTML. The mime is enough
          // to know an uploaded photo exists; the browser fetches it from
          // /api/trainer-photo/[id]. See resolveTrainerPhoto.
          photoMime: trainers.photoMime,
          experience: trainers.experience,
          ptFee: trainers.ptFee,
          isOwner: trainers.isOwner,
          instagramUrl: trainers.instagramUrl,
          branchCode: branches.code,
          branchName: branches.name,
        })
        .from(trainers)
        .leftJoin(branches, eq(trainers.branchId, branches.id)),
      getVisibleReviews(),
    ]);

  let allBranches, allTrainers, publicReviews;
  try {
    [allBranches, allTrainers, publicReviews] = await fetchAll();
  } catch (e) {
    console.error("[Home] first attempt failed, retrying once:", e);
    [allBranches, allTrainers, publicReviews] = await fetchAll();
  }

  return { allBranches, allTrainers, publicReviews };
}

/**
 * ₹ figures that a person reads, grouped the Indian way (1,00,000 — not
 * 100,000). Used for FAQ copy and meta descriptions; the JSON-LD `price` fields
 * stay unformatted, because those are parsed rather than read.
 */
const inr = (n: number) => new Intl.NumberFormat("en-IN").format(n);


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

  // Cheapest advertised PT rate, from the trainer rows the Trainers section
  // already renders. The FAQ markup used to assert "PT fees start from
  // ₹3,000/month" with nothing on the page to back it up.
  const ptFees = allTrainers.map((t) => t.ptFee).filter((f) => f > 0);
  const ptFrom = ptFees.length > 0 ? Math.min(...ptFees) : null;

  // ===== FAQ: ONE SOURCE FOR THE VISIBLE COPY AND THE FAQPage MARKUP =====
  //
  // These were two hand-maintained lists — an inline array in the section below
  // and a separate mainEntity block in the JSON-LD at the bottom of this file —
  // and they had drifted badly. The markup claimed "fees start from ₹900/month
  // to ₹1500/month" and "PT fees start from ₹3,000/month" while the visible
  // answers named no figures at all, and the markup was missing a question the
  // page actually shows.
  //
  // That is still worth avoiding, but the reason has changed and it is worth
  // being accurate about what this markup now buys.
  //
  // Google retired FAQ rich results on 8 August 2023; they are restricted to
  // authoritative government and health sites, and this is a gym. So the
  // mismatch would no longer cost a rich result, because there is none to lose.
  // What FAQPage is actually for now is machine reading: it is how an assistant
  // answering "which gyms are near Janakpuri and what do they charge" gets a
  // clean, attributable answer instead of guessing from prose. That is AEO, not
  // SEO, and it is the channel the FAQ markup is kept for.
  //
  // Rendering both from this one array makes a future mismatch impossible, and
  // every figure in it comes from the rows the site already sells and staffs
  // from, so a price change in the admin panel reaches that answer too.
  const faqs = [
    {
      q: "Where are Brothers Gym located?",
      a: `We have ${allBranches.length} branches in Delhi: ${allBranches
        .map((b) => `${b.name} (${b.address.split(",").slice(0, 2).join(",")})`)
        .join(" and ")}. Both branches offer the same premium quality.`,
    },
    {
      q: "What are the membership fees?",
      // Names the actual range rather than sending the reader off to another
      // page for it. The previous answer deferred to /join, which was the only
      // place the numbers existed -- and /join only produces them in the browser
      // after a branch is picked, so this answer described a page that a crawler
      // sees as priceless. Every figure here comes from the same rows the table
      // above renders.
      a: pricing
        ? `Across both branches, plans run from ₹${inr(
            pricing.min
          )} for a single month to ₹${inr(
            pricing.max
          )} for a full year, with a cheaper weights-only tier and a cardio tier at every duration. The 3, 6 and 12-month plans work out cheaper per month. Both branches' complete price lists are in the Plans & Pricing section above.`
        : "Membership fees vary by branch. Visit our Join Online page and select your preferred branch to see the exact pricing for 1, 3, 6, or 12-month plans with or without cardio access.",
    },
    {
      q: "What are the gym timings?",
      a: "Sagar Pur branch operates in split timings (Morning: 5:30 AM – 12:00 PM, Evening: 4:00 PM – 10:00 PM). Nangal Raya branch is open full day: 5:30 AM – 10:00 PM. Both branches are closed on Sundays.",
    },
    {
      q: "Do you offer personal training?",
      a: ptFrom
        ? `Yes, both branches have experienced personal trainers. PT fees start from ₹${inr(
            ptFrom
          )}/month — check our Trainers section to see the coaches at each branch and their individual fees.`
        : "Yes, both branches have experienced personal trainers. Check our Trainers section to see the coaches at each branch and their PT fees.",
    },
    {
      q: "Can I join online?",
      a: "Yes! Visit our Join Online page, choose your preferred branch, pick a plan, and pay by UPI. Your membership is activated once the gym confirms your payment.",
    },
    {
      q: "Can I use my membership at both branches?",
      a: "Currently, memberships are branch-specific. If you want to switch or use both, please talk to the owner directly.",
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 font-sans selection:bg-yellow-500 selection:text-black">
      {/* ============ NAVBAR ============ */}
      {/* Scroll-reactive client component: overlays the hero, dark at the top
          for legibility over the video, fading transparent as you scroll down.
          Lives in its own component because this page is a Server Component. */}
      <PublicNavbar />

      {/* ============ HERO ============ */}
      <section className="relative min-h-[70svh] md:min-h-screen flex items-end pt-20 px-4 md:px-6 border-b border-zinc-800 overflow-hidden">
        <HeroBackground />
        {/* Stronger left fade so text stays readable; logo side stays open */}
        <div className="absolute inset-0 bg-linear-to-r from-black/70 via-black/45 to-black/20"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--tw-gradient-stops))] from-yellow-900/15 via-transparent to-transparent"></div>

        <div className="relative max-w-7xl mx-auto w-full pt-10 md:pt-12 pb-6 md:pb-8 z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-6 items-center">

            {/* ===== LEFT: redesigned content block ===== */}
            <div className="md:col-span-7 lg:col-span-7 flex flex-col items-start">

              {/* Eyebrow row */}
              <div className="flex flex-wrap items-center gap-3 mb-5 md:mb-6">
                <span className="inline-flex items-center gap-2 border border-yellow-500/40 bg-yellow-500/10 px-3.5 py-1.5 rounded-full text-yellow-500 font-bold text-[11px] md:text-xs tracking-[0.2em] uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                  Now at {allBranches.length} locations
                </span>
              </div>

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
                  visible page states anyway: "Now at 2 locations" sits directly
                  above, and both addresses are printed in full under
                  #locations. */}
              <h1
                className={`${bebas.className} w-full text-[clamp(3.25rem,9vw,7.75rem)] leading-[0.86] tracking-[0.02em] uppercase`}
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
                <p className="text-zinc-400 text-sm md:text-base leading-snug">
                  Same intensity. Same discipline. Two doors in Delhi.
                </p>
              </div>

              {/* CTA cluster */}
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <Link
                  href="/join"
                  className="bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wider text-sm md:text-base px-4 md:px-6 py-2.5 md:py-3 rounded-lg transition-transform hover:scale-[1.03] active:scale-95 text-center flex items-center justify-center gap-2 shadow-[0_0_30px_-8px_rgba(234,179,8,0.55)]"
                >
                  Join Now <ArrowRight size={16} />
                </Link>
                <a
                  href="#locations"
                  className="border border-zinc-600 hover:border-yellow-500/50 text-zinc-200 hover:text-yellow-500 font-bold uppercase tracking-wider px-4 md:px-6 py-2.5 md:py-3 rounded-lg transition-colors text-center text-sm"
                >
                  View Locations
                </a>
              </div>

              {/* Bottom meta strip — anchors the block so it doesn’t float */}
              <div className="mt-6 md:mt-8 pt-5 border-t border-zinc-800/80 flex flex-wrap gap-x-8 gap-y-3 text-[11px] md:text-xs uppercase tracking-[0.18em] text-zinc-500">
                <span className="text-zinc-300">
                  <span className="text-yellow-500 font-black">01</span> Strength
                </span>
                <span className="text-zinc-300">
                  <span className="text-yellow-500 font-black">02</span> Cardio
                </span>
                <span className="text-zinc-300">
                  <span className="text-yellow-500 font-black">03</span> Personal Training
                </span>
              </div>
            </div>

            {/* ===== RIGHT: original logo, slightly smaller ===== */}
            {/* Hidden on phones — the navbar already carries the mark, and the
                big circle only pushed the hero content down on a small screen.
                Shows from md up, where there's room beside the headline. */}
            <div className="md:col-span-5 lg:col-span-5 w-full hidden md:flex justify-center md:justify-end">
              <div className="w-full max-w-60 sm:max-w-[280px] md:max-w-[300px] lg:max-w-[340px] relative">
                <div className="aspect-square rounded-full border-4 border-zinc-800 overflow-hidden bg-zinc-900/50 shadow-2xl relative">
                  <div className="absolute inset-0 bg-yellow-500/10 rounded-full blur-3xl -z-10"></div>
                  <img
                    src="/images/brothers-gym-logo.svg"
                    alt="Brothers Gym logo"
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
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent"></div>

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center space-y-4 mb-6 md:mb-12">
            <p className="text-yellow-500 text-xs md:text-sm font-bold tracking-[0.4em] uppercase">
              — Why Choose Us —
            </p>
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight text-white">
              Why Choose <span className="text-yellow-500">Us</span>
            </h2>
            <p className="text-base md:text-lg text-zinc-400 leading-relaxed max-w-3xl mx-auto">
              Founded with a passion for true fitness, Brothers Gym provides top-tier equipment, expert guidance, and an electrifying atmosphere. We believe in raw hard work, dedication, and results.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            <FeatureCard
              number="01"
              icon={<Dumbbell size={28} />}
              title="Better Equipment"
              description="Machinery carefully selected to optimize your growth and safety."
            />
            <FeatureCard
              number="02"
              icon={<UserCircle size={28} />}
              title="Expert Coaching"
              description="Personalized training programs designed by experienced professionals to hit your goals."
            />
            <FeatureCard
              number="03"
              icon={<Building2 size={28} />}
              title={`${allBranches.length} Locations`}
              description={`Choose from ${allBranches.map((b) => b.name).join(" & ")} — both offer the same quality.`}
            />
          </div>
        </div>
      </section>

      <BMICalculator />
      <ReviewsSection reviews={publicReviews} />

      {/* ============ TEAM SECTION ============ */}
      <section id="staff" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-6 md:mb-12">
            <p className="text-yellow-500 text-xs md:text-sm font-bold tracking-[0.4em] uppercase mb-3">
              — Meet Our Squad —
            </p>
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-4">
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
            <div className="text-center py-12 text-zinc-500 italic">
              Our team profiles are currently being updated. Check back soon!
            </div>
          )}
        </div>
      </section>

      {/* ============ PRICING ============ */}
      {/* Server-rendered, and that is the whole point of it.
          Every price on this site was until now reachable only by running
          JavaScript: /join fetches its plans in a useEffect after you pick a
          branch, so its HTML has always shipped zero prices, and the homepage
          quoted a single "from ₹X" figure inside prose. Neither is something a
          search engine or an assistant can lift an answer out of, and "how much
          is a membership" is the question that decides whether someone walks in.
          This table is drawn on the server from the same membership_plans rows
          the join page sells from, so it is in the HTML on the first byte, and
          it cannot drift from what the counter charges: an owner editing a price
          in the admin panel calls revalidatePath("/") and this redraws. */}
      {pricing && (
        <section id="pricing" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-6 md:mb-12">
              <p className="text-yellow-500 text-xs md:text-sm font-bold tracking-[0.4em] uppercase mb-3">
                — Membership —
              </p>
              <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-4">
                Plans &amp; <span className="text-yellow-500">Pricing</span>
              </h2>
              <p className="text-base md:text-lg text-zinc-400 max-w-2xl mx-auto">
                Every duration comes in two tiers — with or without cardio access.
                The two branches price them separately, so both are listed in full.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {allBranches.map((branch) => {
                const plans = pricing.plans.filter((p) => p.branchId === branch.id);
                if (plans.length === 0) return null;
                return (
                  <div
                    key={branch.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
                  >
                    <div className="px-5 py-4 border-b border-zinc-800">
                      <h3 className="text-xl md:text-2xl font-black uppercase tracking-widest text-white">
                        {branch.name}
                      </h3>
                      <p className="text-[11px] text-zinc-500 uppercase tracking-widest mt-1">
                        {branch.address.split(",").slice(0, 2).join(",")}
                      </p>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          <th className="text-left font-bold px-5 py-3">Plan</th>
                          <th className="text-right font-bold px-5 py-3">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plans.map((p, i) => {
                          // Shown only for the longer plans, where the yearly
                          // saving is the actual decision. On a 1-month plan the
                          // per-month figure is the price again.
                          const perMonth =
                            p.durationDays > 31
                              ? Math.round(p.price / (p.durationDays / 30))
                              : 0;
                          return (
                            <tr key={i} className="border-t border-zinc-800/70">
                              <td className="px-5 py-3 text-zinc-200 font-semibold">
                                {p.name}
                              </td>
                              <td className="px-5 py-3 text-right whitespace-nowrap">
                                <span className="text-yellow-500 font-black">
                                  ₹{inr(p.price)}
                                </span>
                                {perMonth > 0 && (
                                  <span className="block text-[10px] text-zinc-500">
                                    ₹{inr(perMonth)}/month
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div className="px-5 py-4 border-t border-zinc-800">
                      <Link
                        href="/join"
                        className="text-yellow-500 hover:text-yellow-400 font-bold uppercase tracking-wider text-xs inline-flex items-center gap-2"
                      >
                        Join {branch.name} <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ============ FAQ ============ */}
      <section id="faq" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-6 md:mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-4">
              <HelpCircle size={24} className="text-yellow-500" />
            </div>
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight mb-4">
              Frequently Asked <span className="text-yellow-500">Questions</span>
            </h2>
            <p className="text-zinc-400 text-base md:text-lg">
              Everything you need to know before walking through our doors.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group bg-zinc-900 border border-zinc-800 hover:border-yellow-500/30 rounded-xl overflow-hidden transition-colors"
              >
                <summary className="font-bold cursor-pointer text-white flex justify-between items-center p-5 gap-4 list-none">
                  <span className="text-sm md:text-base">{faq.q}</span>
                  <span className="w-8 h-8 bg-yellow-500/20 group-hover:bg-yellow-500 text-yellow-500 group-hover:text-black rounded-lg flex items-center justify-center transition-colors shrink-0 text-lg font-black">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <div className="px-5 pb-5">
                  <p className="text-zinc-400 leading-relaxed text-sm md:text-base border-t border-zinc-800 pt-4">
                    {faq.a}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer id="contact" className="bg-zinc-950 pt-10 md:pt-16 pb-8 px-4 md:px-6 relative overflow-hidden border-t border-zinc-900">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-yellow-500/5 rounded-full blur-3xl z-0"></div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5 md:gap-6 mb-6 pb-6 md:mb-12 md:pb-12 border-b border-zinc-900">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <img src="/images/brothers-gym-logo.svg" alt="Brothers Gym logo" loading="lazy" decoding="async" className="h-14 w-14 rounded-full" />
                <div>
                  <h3 className="text-xl md:text-2xl font-black uppercase tracking-widest text-white">
                    Brothers<span className="text-yellow-500">Gym</span>
                  </h3>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    Two Brothers · Two Locations
                  </p>
                </div>
              </div>
              <p className="text-zinc-400 max-w-md text-sm md:text-base">
                Ready to start your journey? Drop by any of our branches or give us a call. We&apos;re ready when you are.
              </p>
            </div>

            <Link
              href="/join"
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wider px-6 md:px-8 py-3 md:py-4 rounded-lg transition-transform hover:scale-105 active:scale-95 text-center whitespace-nowrap flex items-center justify-center gap-2 self-start"
            >
              Join Online <ArrowRight size={18} />
            </Link>
          </div>

          {/* No scroll-mt here any more: the offset moved to a single
              scroll-padding-top on html, which now covers every anchor. A
              scroll-mt would stack on top of it and land this grid ~96px lower
              than the rest. See the note in globals.css. */}
          <div id="locations" className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6 mb-6 md:mb-12">
            {/* MOBILE DENSITY — every change below is `max-md:` scoped, so the
                md: layout keeps its exact previous classes.

                The card is ~140px of content wide on a phone, and the 44px boxed
                icon plus a 12px gap was eating 56px of that — 40%. The title,
                the owner name and a 90-character address were all fighting over
                what was left, which is why "NANGAL RAYA" broke onto two lines and
                the address onto seven.

                So the icon shrinks to 16px inline, the type steps down one notch,
                and the phone number becomes a full-width pill — it is the card's
                only action and a plain text row did not read as tappable. */}
            {allBranches.map((branch) => (
              <div
                key={branch.id}
                className="bg-zinc-900/60 border border-zinc-800 hover:border-yellow-500/40 p-4 md:p-6 rounded-2xl transition-colors group max-md:p-3 max-md:rounded-xl"
              >
                <div className="flex items-center gap-3 mb-4 md:mb-5 max-md:gap-2 max-md:mb-2.5">
                  <div className="w-11 h-11 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-center group-hover:bg-yellow-500 group-hover:border-yellow-500 transition-colors max-md:shrink-0 max-md:w-7 max-md:h-7 max-md:rounded-md">
                    <Building2 size={20} className="text-yellow-500 group-hover:text-black transition-colors max-md:w-4 max-md:h-4" />
                  </div>
                  <div className="max-md:min-w-0">
                    <h4 className="font-black text-white uppercase tracking-wide text-sm md:text-base max-md:text-[13px] max-md:leading-tight">
                      {branch.name}
                    </h4>
                    <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                      Branch · {branch.code}
                    </span>
                    {branch.ownerName && (
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        Owner: <span className="text-zinc-300">{branch.ownerName}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 text-sm max-md:space-y-2 max-md:text-[11px]">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-zinc-300 hover:text-yellow-500 transition-colors"
                  >
                    <MapPin size={16} className="text-yellow-500 shrink-0 mt-0.5 max-md:w-3.5 max-md:h-3.5" />
                    <span className="leading-relaxed max-md:leading-snug">{branch.address}</span>
                  </a>
                  {branch.phone && (
                    <a
                      href={`tel:${branch.phone}`}
                      className="flex items-center gap-2 text-zinc-300 hover:text-yellow-500 transition-colors max-md:w-full max-md:justify-center max-md:gap-1.5 max-md:rounded-lg max-md:border max-md:border-zinc-800 max-md:bg-zinc-800/40 max-md:py-1.5 max-md:text-yellow-500"
                    >
                      <Phone size={16} className="text-yellow-500 max-md:w-3.5 max-md:h-3.5" />
                      <span className="font-medium max-md:font-semibold">{branch.phone}</span>
                    </a>
                  )}
                </div>
              </div>
            ))}

            {/* Spans both phone columns: the split-timings rows below use
                justify-between, which collides in a half-width card.

                Its header is matched to the branch cards above (max-md: only) so
                the three cards stacked in this grid read as one design. The body
                is left alone — it is full-width here and already runs at text-xs. */}
            <div className="col-span-2 md:col-span-1 bg-zinc-900/60 border border-zinc-800 p-4 md:p-6 rounded-2xl max-md:p-3 max-md:rounded-xl">
              <div className="flex items-center gap-3 mb-5 max-md:gap-2 max-md:mb-2.5">
                <div className="w-11 h-11 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-center max-md:shrink-0 max-md:w-7 max-md:h-7 max-md:rounded-md">
                  <Clock size={20} className="text-yellow-500 max-md:w-4 max-md:h-4" />
                </div>
                <div className="max-md:min-w-0">
                  <h4 className="font-black text-white uppercase tracking-wide text-sm md:text-base max-md:text-[13px] max-md:leading-tight">
                    Opening Hours
                  </h4>
                  <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                    Sunday Closed
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-2">
                  Sagar Pur (Split Timings)
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-800">
                    <span className="text-zinc-400 text-xs">Morning</span>
                    <span className="text-white font-bold text-xs">5:30 AM – 12:00 PM</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-zinc-400 text-xs">Evening</span>
                    <span className="text-white font-bold text-xs">4:00 PM – 10:00 PM</span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-2">
                  Nangal Raya (Full Day)
                </p>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-zinc-400 text-xs">Mon – Sat</span>
                  <span className="text-white font-bold text-xs">5:30 AM – 10:00 PM</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-6 md:pt-8 border-t border-zinc-900 text-sm text-zinc-500">
            <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4 text-center md:text-left">
              <p>&copy; {new Date().getFullYear()} Brothers Gym. All rights reserved.</p>
              <div className="flex flex-wrap justify-center gap-4 text-xs">
                <Link href="/privacy" className="hover:text-yellow-500 transition-colors">Privacy</Link>
                <Link href="/terms" className="hover:text-yellow-500 transition-colors">Terms</Link>
                <Link href="/refund" className="hover:text-yellow-500 transition-colors">Refund</Link>
                <Link href="/contact" className="hover:text-yellow-500 transition-colors">Contact</Link>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs uppercase tracking-widest text-zinc-600">Follow us</span>
              <a
                href="https://www.instagram.com/brothersgym12"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-yellow-500 hover:border-yellow-500 flex items-center justify-center text-zinc-400 hover:text-black transition-all"
                aria-label="Instagram"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                </svg>
              </a>
              <a
                href="https://www.facebook.com/profile.php?id=100063764862295"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-yellow-500 hover:border-yellow-500 flex items-center justify-center text-zinc-400 hover:text-black transition-all"
                aria-label="Facebook"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>

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
                // an SVG is not reliably accepted. The SVG stays the favicon.
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            // Same `faqs` array the section above renders, so the marked-up
            // answer is by construction the answer on the page.
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.a,
              },
            })),
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
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="relative bg-zinc-900 border border-zinc-800 hover:border-yellow-500/50 p-4 md:p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1 group overflow-hidden">
      <div className="absolute -right-2 -top-2 text-[80px] md:text-[100px] font-black text-yellow-500/5 group-hover:text-yellow-500/10 select-none pointer-events-none transition-colors leading-none">
        {number}
      </div>
      <div className="relative">
        <div className="w-11 h-11 md:w-14 md:h-14 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center justify-center text-yellow-500 mb-3 md:mb-5 group-hover:bg-yellow-500 group-hover:text-black transition-all">
          {icon}
        </div>
        <h3 className="text-base md:text-2xl font-black mb-2 md:mb-3 text-white uppercase tracking-wide">
          {title}
        </h3>
        <p className="text-zinc-400 text-xs md:text-base leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}