import { db } from "@/db";
import { trainers, branches } from "@/db/schema";
import { eq } from "drizzle-orm";
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

// One parallel round-trip instead of three sequential awaits, wrapped so a
// transient DB error degrades to empty sections rather than failing the build
// or 500-ing the page.
async function getHomeData() {
  try {
    const [allBranches, allTrainers, publicReviews] = await Promise.all([
      db
        .select()
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(branches.id),
      db
        .select({
          id: trainers.id,
          branchId: trainers.branchId,
          name: trainers.name,
          photoUrl: trainers.photoUrl,
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
    return { allBranches, allTrainers, publicReviews };
  } catch {
    return { allBranches: [], allTrainers: [], publicReviews: [] };
  }
}

export default async function Home() {
  const { allBranches, allTrainers, publicReviews } = await getHomeData();

  const owners = allTrainers.filter((s) => s.isOwner);
  const gymTrainers = allTrainers.filter((s) => !s.isOwner);
  const ratingSummary =
    publicReviews.length > 0
      ? {
          "@type": "AggregateRating",
          ratingValue: (
            publicReviews.reduce((sum, r) => sum + r.rating, 0) /
            publicReviews.length
          ).toFixed(1),
          reviewCount: String(publicReviews.length),
          bestRating: "5",
          worstRating: "1",
        }
      : undefined;

  return (
    <div className="min-h-screen bg-zinc-950 font-sans selection:bg-yellow-500 selection:text-black">
      {/* ============ NAVBAR ============ */}
      {/* Scroll-reactive client component: overlays the hero, dark at the top
          for legibility over the video, fading transparent as you scroll down.
          Lives in its own component because this page is a Server Component. */}
      <PublicNavbar />

      {/* ============ HERO ============ */}
      <section className="relative min-h-svh md:min-h-screen flex items-end pt-20 px-4 md:px-6 border-b border-zinc-800 overflow-hidden">
        <HeroBackground />
        {/* Stronger left fade so text stays readable; logo side stays open */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/20"></div>
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
              <h1
                className={`${bebas.className} w-full text-[clamp(3.25rem,9vw,7.75rem)] leading-[0.86] tracking-[0.02em] uppercase`}
              >
                <span className="block">
                  <span className="text-white">Two</span>{" "}
                  <span className="text-yellow-500">Brothers</span>
                </span>
                <span className="block">
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
              <div className="w-full max-w-[240px] sm:max-w-[280px] md:max-w-[300px] lg:max-w-[340px] relative">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
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
      <ReviewsSection />

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
            trainers={gymTrainers as any}
            owners={owners as any}
          />

          {allTrainers.length === 0 && (
            <div className="text-center py-12 text-zinc-500 italic">
              Our team profiles are currently being updated. Check back soon!
            </div>
          )}
        </div>
      </section>

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
            {[
              {
                q: "Where are Brothers Gym located?",
                a: `We have ${allBranches.length} branches in Delhi: ${allBranches
                  .map((b) => `${b.name} (${b.address.split(",").slice(0, 2).join(",")})`)
                  .join(" and ")}. Both branches offer the same premium quality.`,
              },
              {
                q: "What are the membership fees?",
                a: "Membership fees vary by branch. Visit our Join Online page and select your preferred branch to see the exact pricing for 1, 3, 6, or 12-month plans with or without cardio access.",
              },
              {
                q: "What are the gym timings?",
                a: "Sagar Pur branch operates in split timings (Morning: 5:30 AM – 12:00 PM, Evening: 4:00 PM – 10:00 PM). Nangal Raya branch is open full day: 5:30 AM – 10:00 PM. Both branches are closed on Sundays.",
              },
              {
                q: "Do you offer personal training?",
                a: "Yes, both branches have experienced personal trainers. Check our Trainers section to see the coaches at each branch and their PT fees.",
              },
              {
                q: "Can I join online?",
                a: "Yes! Visit our Join Online page, choose your preferred branch, pick a plan, and pay by UPI. Your membership is activated once the gym confirms your payment.",
              },
              {
                q: "Can I use my membership at both branches?",
                a: "Currently, memberships are branch-specific. If you want to switch or use both, please talk to the owner directly.",
              },
            ].map((faq, i) => (
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

          <div id="locations" className="scroll-mt-24 grid md:grid-cols-3 gap-3 md:gap-6 mb-6 md:mb-12">
            {allBranches.map((branch) => (
              <div
                key={branch.id}
                className="bg-zinc-900/60 border border-zinc-800 hover:border-yellow-500/40 p-4 md:p-6 rounded-2xl transition-colors group"
              >
                <div className="flex items-center gap-3 mb-4 md:mb-5">
                  <div className="w-11 h-11 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-center group-hover:bg-yellow-500 group-hover:border-yellow-500 transition-colors">
                    <Building2 size={20} className="text-yellow-500 group-hover:text-black transition-colors" />
                  </div>
                  <div>
                    <h4 className="font-black text-white uppercase tracking-wide text-sm md:text-base">
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

                <div className="space-y-3 text-sm">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-zinc-300 hover:text-yellow-500 transition-colors"
                  >
                    <MapPin size={16} className="text-yellow-500 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{branch.address}</span>
                  </a>
                  {branch.phone && (
                    <a
                      href={`tel:${branch.phone}`}
                      className="flex items-center gap-2 text-zinc-300 hover:text-yellow-500 transition-colors"
                    >
                      <Phone size={16} className="text-yellow-500" />
                      <span className="font-medium">{branch.phone}</span>
                    </a>
                  )}
                </div>
              </div>
            ))}

            <div className="bg-zinc-900/60 border border-zinc-800 p-4 md:p-6 rounded-2xl">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-center">
                  <Clock size={20} className="text-yellow-500" />
                </div>
                <div>
                  <h4 className="font-black text-white uppercase tracking-wide text-sm md:text-base">
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
            "@type": "HealthClub",
            name: "Brothers Gym",
            description:
              "Premium fitness gym with two locations in Delhi offering strength training, cardio, personal training, and expert coaching.",
            url: "https://brothersgym.in",
            logo: "https://brothersgym.in/images/brothers-gym-logo.svg",
            image: "https://brothersgym.in/images/brothers-gym-logo.svg",
            telephone: ["+917042061402", "+919818921234"],
            priceRange: "₹900 - ₹14000",
            address: allBranches.map((b) => ({
              "@type": "PostalAddress",
              streetAddress: b.address,
              addressLocality: "New Delhi",
              addressRegion: "Delhi",
              postalCode: "110046",
              addressCountry: "IN",
            })),
            geo: [
              { "@type": "GeoCoordinates", latitude: 28.6104029, longitude: 77.1077599 },
              { "@type": "GeoCoordinates", latitude: 28.6071105, longitude: 77.1037377 },
            ],
            openingHoursSpecification: allBranches
              .map((b) => {
                if (b.code === "SP") {
                  return [
                    {
                      "@type": "OpeningHoursSpecification",
                      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                      opens: "05:30",
                      closes: "12:00",
                    },
                    {
                      "@type": "OpeningHoursSpecification",
                      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                      opens: "16:00",
                      closes: "22:00",
                    },
                  ];
                }
                return {
                  "@type": "OpeningHoursSpecification",
                  dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                  opens: "05:30",
                  closes: "22:00",
                };
              })
              .flat(),
            aggregateRating: ratingSummary,
            sameAs: [
              "https://www.instagram.com/brothersgym12",
              "https://www.facebook.com/profile.php?id=100063764862295",
            ],
            hasOfferCatalog: {
              "@type": "OfferCatalog",
              name: "Membership Plans",
              itemListElement: [
                { "@type": "Offer", name: "1 Month Full Access", price: "1500", priceCurrency: "INR" },
                { "@type": "Offer", name: "1 Month No Cardio", price: "1200", priceCurrency: "INR" },
              ],
            },
          }),
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Where are Brothers Gym located?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Brothers Gym has two branches in Delhi: Nangal Raya (WZ-1391/23-B, PT Vishnu Datt Marg, Janakpuri, 110046) and Sagar Pur (WZ-105/46/3, Street No. 5, Mohan Nagar, Main Sagarpur, 110046).",
                },
              },
              {
                "@type": "Question",
                name: "What are the membership fees at Brothers Gym?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Membership fees start from ₹900/month (No Cardio at Sagar Pur) to ₹1500/month (Full Access at Nangal Raya). Discounts available on 3, 6, and 12-month plans.",
                },
              },
              {
                "@type": "Question",
                name: "What are the gym timings?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "The two branches keep different hours. Nangal Raya is open full day, 5:30 AM to 10:00 PM. Sagar Pur runs split timings: 5:30 AM to 12:00 PM in the morning and 4:00 PM to 10:00 PM in the evening. Both branches are closed on Sundays.",
                },
              },
              {
                "@type": "Question",
                name: "Do you offer personal training?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes, both branches have experienced personal trainers. PT fees start from ₹3,000/month.",
                },
              },
              {
                "@type": "Question",
                name: "Can I join Brothers Gym online?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes! Visit our Join Online page, choose your preferred branch, pick a plan, and pay by UPI. Your membership is activated once the gym confirms your payment.",
                },
              },
            ],
          }),
        }}
      />

      <FloatingWhatsApp />
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
    <div className="relative bg-zinc-900 border border-zinc-800 hover:border-yellow-500/50 p-6 md:p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1 group overflow-hidden">
      <div className="absolute -right-2 -top-2 text-[80px] md:text-[100px] font-black text-yellow-500/5 group-hover:text-yellow-500/10 select-none pointer-events-none transition-colors leading-none">
        {number}
      </div>
      <div className="relative">
        <div className="w-14 h-14 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center justify-center text-yellow-500 mb-5 group-hover:bg-yellow-500 group-hover:text-black transition-all">
          {icon}
        </div>
        <h3 className="text-xl md:text-2xl font-black mb-3 text-white uppercase tracking-wide">
          {title}
        </h3>
        <p className="text-zinc-400 text-sm md:text-base leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}