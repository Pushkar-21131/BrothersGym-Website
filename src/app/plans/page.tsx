import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HelpCircle } from "lucide-react";
import { getPlanPricing, type PricedPlan } from "@/lib/plan-pricing";
import { getPublicBranches, getPublicTrainers, inr } from "@/lib/public-data";
import PublicNavbar from "@/app/components/public-navbar";
import PublicFooter from "@/app/components/public-footer";
import FloatingWhatsApp from "@/app/components/floating-whatsapp";

// Same ISR posture as the homepage: public content that changes rarely. The
// admin actions for plans, trainers and branches all call revalidatePath("/plans")
// alongside the homepage's, so an edit refreshes this page on demand; the hourly
// revalidate is just a backstop.
export const revalidate = 3600;

const SITE_URL = "https://brothersgym.in";

/**
 * This page carried no prices in its HTML until now, and neither did any other.
 * /join fetches its plans in a useEffect after you pick a branch, so its markup
 * has always shipped zero prices, and the homepage quoted one "from ₹X" figure
 * inside prose. Neither is something a search engine or an assistant can lift an
 * answer out of, and "how much is a membership" is the question that decides
 * whether someone walks in. The table below is drawn on the server from the same
 * membership_plans rows the join page sells from, so it is in the HTML on the
 * first byte and cannot drift from what the counter charges.
 */
export async function generateMetadata(): Promise<Metadata> {
  const pricing = await getPlanPricing();
  const from = pricing
    ? `from ₹${inr(pricing.monthlyMin)}/month`
    : "on flexible monthly plans";

  return {
    // Named explicitly. The root layout declares no canonical on purpose — it
    // used to declare the homepage's, which every other page inherited and
    // de-indexed itself with — so each page names itself and this is this one's.
    alternates: { canonical: "/plans" },
    title: "Plans, Pricing & FAQ",
    description: `Brothers Gym membership prices ${from} at both Delhi branches — Nangal Raya (Janakpuri) and Sagar Pur. Full price tables, timings, and answers to the questions we get most.`,
  };
}

/**
 * One price cell of the price table — and it returns `<td>` itself, so a row
 * stays a flat three-column grid rather than nesting a wrapper that would need
 * its own column maths.
 *
 * It takes a LIST, not a plan, and that is the difference between a table that
 * is merely tidy and one that is true. Nothing constrains membership_plans to
 * two rows per duration — the unique index is on (branch_id, code) — so an owner
 * adding a "Student 3-month" plan would collide with the 3-month tier. A cell
 * that showed only the first match would drop it from the page silently, which
 * is how a page ends up quoting a price list that is missing a price. Two plans
 * in one cell stack and name themselves.
 *
 * A branch that does not sell a tier at a duration gets an em dash, not a
 * missing cell. The two branch cards must stay the same shape, or the columns
 * stop lining up with their headings.
 *
 * The per-month figure is shown only on plans longer than a month, where the
 * saving is the actual decision. On a 1-month plan it is the price again.
 */
function PriceCell({ plans, last }: { plans: PricedPlan[]; last?: boolean }) {
  const pad = last ? "pl-1.5 pr-4 md:pr-5" : "px-1.5";
  if (plans.length === 0) {
    return <td className={`${pad} py-2.5 text-right align-top text-zinc-600`}>—</td>;
  }
  return (
    <td className={`${pad} py-2.5 text-right align-top whitespace-nowrap`}>
      {plans.map((plan) => {
        const perMonth =
          plan.durationDays > 31 ? Math.round(plan.price / (plan.durationDays / 30)) : 0;
        return (
          <span key={`${plan.name}-${plan.price}`} className="block">
            {plans.length > 1 && (
              <span className="block text-[9px] font-normal text-zinc-400 leading-tight">
                {plan.name}
              </span>
            )}
            <span className="text-yellow-500 font-black">₹{inr(plan.price)}</span>
            {perMonth > 0 && (
              <span className="block text-[9px] md:text-[10px] font-normal text-zinc-500 leading-tight">
                ₹{inr(perMonth)}/mo
              </span>
            )}
          </span>
        );
      })}
    </td>
  );
}

export default async function PlansPage() {
  const [allBranches, allTrainers, pricing] = await Promise.all([
    getPublicBranches(),
    getPublicTrainers(),
    getPlanPricing(),
  ]);

  const ptFees = allTrainers.map((t) => t.ptFee).filter((f) => f > 0);
  const ptFrom = ptFees.length > 0 ? Math.min(...ptFees) : null;

  // The questions, and the FAQPage markup below is generated from this same
  // array — which is the only reason the markup is trustworthy.
  //
  // A mismatch between the marked-up answer and the one on the page is the
  // failure mode of hand-written FAQ structured data, and this page had it: the
  // markup answered with prices from the database while the visible answer
  // deferred to /join. Google retired FAQ rich results on 8 August 2023; they
  // are restricted to authoritative government and health sites, and this is a
  // gym. So the mismatch would no longer cost a rich result, because there is
  // none to lose. What FAQPage is actually for now is machine reading: it is how
  // an assistant answering "which gyms are near Janakpuri and what do they
  // charge" gets a clean, attributable answer instead of guessing from prose.
  // That is AEO, not SEO, and it is the channel this markup is kept for.
  //
  // Rendering both from one array makes a future mismatch impossible, and every
  // figure in it comes from the rows the site already sells and staffs from, so
  // a price change in the admin panel reaches that answer too.
  //
  // The answers are plain strings, not JSX: they are rendered as text here and
  // fed to the JSON-LD as `text`, so a link cannot live inside one.
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
      // sees as priceless. Every figure here comes from the same rows the tables
      // above render.
      a: pricing
        ? `Across both branches, plans run from ₹${inr(
            pricing.min
          )} for a single month to ₹${inr(
            pricing.max
          )} for a full year, with a cheaper weights-only tier and a cardio tier at every duration. The 3, 6 and 12-month plans work out cheaper per month. Both branches' complete price lists are in the tables above.`
        : "Membership fees vary by branch. Visit our Join Online page and select your preferred branch to see the exact pricing for 1, 3, 6, or 12-month plans with or without cardio access.",
    },
    {
      q: "What are the gym timings?",
      a: "Sagar Pur branch operates in split timings (Morning: 5:30 AM – 12:00 PM, Evening: 4:00 PM – 10:00 PM). Nangal Raya branch is open full day: 5:30 AM – 10:00 PM. Both branches are closed on Sundays.",
    },
    {
      q: "Do you offer personal training?",
      // Points at the homepage, which is where the trainers are: the coaches and
      // their fees did not move to this page, and an answer that says "see the
      // Trainers section" on a page with no trainers section is a dead end.
      a: ptFrom
        ? `Yes, both branches have experienced personal trainers. PT fees start from ₹${inr(
            ptFrom
          )}/month — the coaches at each branch and their individual fees are listed in the Trainers section of our home page.`
        : "Yes, both branches have experienced personal trainers. The coaches at each branch and their PT fees are listed in the Trainers section of our home page.",
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
      <PublicNavbar />

      {/* pt-28 clears the fixed 80px bar, which sits over the top of this page
          the same way it sits over the hero on the homepage. */}
      <section className="pt-28 md:pt-36 pb-10 md:pb-14 px-4 md:px-6 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-yellow-500 text-xs md:text-sm font-bold tracking-[0.4em] uppercase mb-3">
            — Brothers Gym —
          </p>
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-4">
            Plans &amp; <span className="text-yellow-500">FAQ</span>
          </h1>
          <p className="text-sm md:text-base text-zinc-400 max-w-2xl mx-auto">
            Every plan at both branches, at every duration — and the answers to what
            people ask us most before they join.
          </p>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      {pricing ? (
        <section id="pricing" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-5 md:mb-9">
              <p className="text-yellow-500 text-xs md:text-sm font-bold tracking-[0.4em] uppercase mb-3">
                — Membership —
              </p>
              <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-3">
                Plans &amp; <span className="text-yellow-500">Pricing</span>
              </h2>
              <p className="text-sm md:text-base text-zinc-400 max-w-xl mx-auto">
                Both tiers at every duration — with or without cardio access. Each
                branch prices its own.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
              {allBranches.map((branch) => {
                const plans = pricing.plans.filter((p) => p.branchId === branch.id);
                if (plans.length === 0) return null;

                // ONE ROW PER DURATION, ONE COLUMN PER TIER.
                //
                // This shipped first as one row per plan: eight rows a branch,
                // and both branches stacked on a phone, so reaching the second
                // gym's 12-month price meant scrolling past fifteen rows. It is
                // now four rows — and the shorter table is not even the main
                // gain. Two tiers side by side is the comparison a reader
                // actually makes ("is cardio worth the difference"), and that
                // used to require holding four rows apart in your head.
                //
                // Grouped on durationDays and includesCardio, both real columns.
                // Not parsed out of `name`: the tier is the difference between
                // two plans that share a duration, which is precisely what a
                // name regex gets silently backwards.
                //
                // A duration a branch does not sell renders an em dash rather
                // than disappearing, so the two cards keep the same set of rows.
                const durations = [...new Set(plans.map((p) => p.durationDays))].sort(
                  (a, b) => a - b
                );

                return (
                  <div
                    key={branch.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
                  >
                    {/* Name and the call to action share a line. The button used
                        to sit in a footer band of its own, which cost every
                        reader a row of height for one link. */}
                    <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-zinc-800">
                      <div className="min-w-0">
                        <h3 className="text-lg md:text-xl font-black uppercase tracking-widest text-white leading-none">
                          {branch.name}
                        </h3>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1.5 truncate">
                          {branch.address.split(",").slice(0, 2).join(",")}
                        </p>
                      </div>
                      <Link
                        href="/join"
                        className="shrink-0 inline-flex items-center gap-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wider text-[11px] px-3 py-2 rounded-lg transition-colors"
                      >
                        Join<span className="sr-only"> {branch.name}</span>
                        <ArrowRight size={13} />
                      </Link>
                    </div>

                    <table className="w-full text-[13px] md:text-sm">
                      <thead>
                        <tr className="text-[9px] md:text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                          <th scope="col" className="text-left font-bold pl-4 md:pl-5 pr-1 py-2.5">
                            Duration
                          </th>
                          <th scope="col" className="text-right font-bold px-1.5 py-2.5">
                            Hardcore
                          </th>
                          <th scope="col" className="text-right font-bold pl-1.5 pr-4 md:pr-5 py-2.5">
                            Cardio
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {durations.map((days) => {
                          const at = plans.filter((p) => p.durationDays === days);
                          const months = Math.max(1, Math.round(days / 30));
                          return (
                            <tr key={days} className="border-t border-zinc-800/70">
                              <th
                                scope="row"
                                className="text-left align-top font-semibold text-zinc-200 pl-4 md:pl-5 pr-1 py-2.5 whitespace-nowrap"
                              >
                                {months} {months === 1 ? "Month" : "Months"}
                              </th>
                              <PriceCell plans={at.filter((p) => !p.includesCardio)} />
                              <PriceCell plans={at.filter((p) => p.includesCardio)} last />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        // A gym with no active plans is a real state — a new branch mid-setup.
        // The old homepage simply hid the section, which was safe when it was
        // one section among nine; here it would leave a page headed "Plans &
        // Pricing" with no prices on it at all.
        <section className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800">
          <p className="max-w-4xl mx-auto text-center text-sm md:text-base text-zinc-400">
            Our current price list is being updated. Call either branch and we&apos;ll
            confirm today&apos;s rates, or start your membership on our{" "}
            <Link href="/join" className="text-yellow-500 hover:text-yellow-400">
              Join Online
            </Link>{" "}
            page.
          </p>
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

      <PublicFooter branches={allBranches} />

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
