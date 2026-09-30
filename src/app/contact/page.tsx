import LegalLayout from "@/app/components/legal-layout";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Mail, Phone, MessageCircle, MapPin, Clock, Building2 } from "lucide-react";

export const metadata = {
  title: "Contact Us",
  description:
    "Get in touch with Brothers Gym owners at Nangal Raya or Sagar Pur branches.",
  // This page carries both branches' full NAP, hours and Google Maps links, so
  // it is the page the Google Business Profiles have to agree with. It used to
  // inherit the homepage's canonical and de-index itself.
  alternates: { canonical: "/contact" },
};

const SECTIONS = [
  { id: "branches", label: "Branch Contacts" },
  { id: "hours", label: "Opening Hours" },
  { id: "response", label: "Response Times" },
];

async function getBranches() {
  try {
    return await db
      .select()
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.id);
  } catch {
    return [];
  }
}

export default async function ContactPage() {
  const allBranches = await getBranches();

  return (
    <LegalLayout
      title="Contact Us"
      eyebrow="Get in touch"
      subtitle="Reach out to the branch owners directly for any query about membership, timings, or payments."
      sections={SECTIONS}
      currentPath="/contact"
    >
      <div className="not-prose">
        {/* Three channels, stated plainly. These are labels, not buttons — the
            real actions are the per-branch call/WhatsApp rows below, and cards
            that look tappable but do nothing read as unfinished. */}
        <div className="mb-10 grid grid-cols-3 divide-x divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <Channel
            icon={<MessageCircle size={18} />}
            title="WhatsApp"
            sub="Fastest — usually within 1 hour"
          />
          <Channel
            icon={<Phone size={18} />}
            title="Phone"
            sub="During gym hours"
          />
          <Channel
            icon={<MapPin size={18} />}
            title="Visit"
            sub="Two branches in Delhi"
          />
        </div>

        {/* Branch contacts */}
        <section id="branches" className="scroll-mt-24 mb-10">
          <h2 className="mb-4 flex items-center gap-2.5 text-lg font-black text-white md:text-xl">
            <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-yellow-500" />
            <Building2 size={18} className="text-yellow-500" />
            Branch Contacts
          </h2>

          {allBranches.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
              Branch details are temporarily unavailable. Please visit us in person or
              reach out through the WhatsApp button on this page.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {allBranches.map((branch) => (
                <div
                  key={branch.id}
                  className="bg-zinc-900 border border-zinc-800 hover:border-yellow-500/40 rounded-2xl p-5 transition-colors"
                >
                  {/* Branch header */}
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-zinc-800">
                    <div className="w-12 h-12 bg-yellow-500/15 border border-yellow-500/30 rounded-xl flex items-center justify-center shrink-0">
                      <Building2 size={20} className="text-yellow-500" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-white truncate">
                        {branch.name}
                      </h3>
                      <span className="text-[10px] text-yellow-500 font-black tracking-widest uppercase">
                        Branch &middot; {branch.code}
                      </span>
                    </div>
                  </div>

                  {branch.ownerName && (
                    <div className="mb-4">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1">
                        Owner
                      </p>
                      <p className="text-white font-bold">{branch.ownerName}</p>
                    </div>
                  )}

                  {/* Contact methods */}
                  <div className="space-y-2">
                    {branch.phone && (
                      <>
                        <a
                          href={`tel:${branch.phone}`}
                          className="flex items-center gap-3 p-2.5 rounded-lg border border-zinc-800 hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-colors"
                        >
                          <span className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                            <Phone size={15} className="text-yellow-500" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
                              Call
                            </span>
                            <span className="block text-white font-bold text-sm truncate">
                              {branch.phone}
                            </span>
                          </span>
                        </a>

                        <a
                          href={`https://wa.me/${branch.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                            `Hi ${branch.ownerName || "Brothers Gym"}! I want to know more about Brothers Gym ${branch.name} membership.`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-2.5 rounded-lg border border-zinc-800 hover:border-green-500/50 hover:bg-green-500/5 transition-colors"
                        >
                          <span className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                            <MessageCircle size={15} className="text-green-400" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
                              WhatsApp
                            </span>
                            <span className="block text-white font-bold text-sm truncate">
                              {branch.phone}
                            </span>
                          </span>
                        </a>
                      </>
                    )}

                    {branch.ownerEmail && (
                      <a
                        href={`mailto:${branch.ownerEmail}`}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-zinc-800 hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-colors"
                      >
                        <span className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                          <Mail size={15} className="text-yellow-500" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
                            Email
                          </span>
                          <span className="block text-white font-bold text-sm truncate">
                            {branch.ownerEmail}
                          </span>
                        </span>
                      </a>
                    )}
                  </div>

                  {/* Address */}
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1.5">
                      Address
                    </p>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-2">
                      {branch.address}
                    </p>
                    <a
                      href={
                        branch.mapUrl ||
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-500 hover:text-yellow-400"
                    >
                      <MapPin size={12} /> Get Directions
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Opening hours */}
        <section id="hours" className="scroll-mt-24 mb-10">
          <h2 className="mb-4 flex items-center gap-2.5 text-lg font-black text-white md:text-xl">
            <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-yellow-500" />
            <Clock size={18} className="text-yellow-500" />
            Opening Hours
          </h2>

          <div className="grid sm:grid-cols-2 gap-3">
            <HoursCard
              branch="Nangal Raya"
              tag="Full Day"
              rows={[
                { label: "Mon – Sat", value: "5:30 AM – 10:00 PM" },
                { label: "Sunday", value: "Closed", closed: true },
              ]}
            />
            <HoursCard
              branch="Sagar Pur"
              tag="Split Timings"
              rows={[
                { label: "Morning", value: "5:30 AM – 12:00 PM" },
                { label: "Evening", value: "4:00 PM – 10:00 PM" },
                { label: "Sunday", value: "Closed", closed: true },
              ]}
            />
          </div>
        </section>

        {/* Response time */}
        <section id="response" className="scroll-mt-24">
          <h2 className="mb-4 flex items-center gap-2.5 text-lg font-black text-white md:text-xl">
            <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-yellow-500" />
            Response Times
          </h2>

          <dl className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800">
            {[
              { dt: "WhatsApp", dd: "Usually within 1 hour during business hours" },
              { dt: "Phone", dd: "Available during gym hours" },
              { dt: "Email", dd: "Within 24–48 hours" },
              { dt: "Legal / Grievance", dd: "Within 30 days, as required by the DPDP Act 2023" },
            ].map((row) => (
              <div
                key={row.dt}
                className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <dt className="text-[11px] font-black uppercase tracking-[0.15em] text-yellow-500 sm:w-40 sm:shrink-0">
                  {row.dt}
                </dt>
                <dd className="text-sm text-zinc-400">{row.dd}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </LegalLayout>
  );
}

function Channel({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="px-3 py-4 text-center">
      <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-500">
        {icon}
      </span>
      <p className="text-[11px] font-black uppercase tracking-wider text-white">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{sub}</p>
    </div>
  );
}

function HoursCard({
  branch,
  tag,
  rows,
}: {
  branch: string;
  tag: string;
  rows: { label: string; value: string; closed?: boolean }[];
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-black text-white">{branch}</p>
        <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-yellow-500">
          {tag}
        </span>
      </div>
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <dt className="text-zinc-500">{r.label}</dt>
            <dd className={r.closed ? "font-bold text-red-400" : "font-bold text-white"}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
