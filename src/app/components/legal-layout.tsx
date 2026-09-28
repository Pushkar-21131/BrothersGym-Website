import Link from "next/link";
import { ArrowLeft, ChevronDown, MapPin, Phone, Mail, Building2 } from "lucide-react";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";

async function getBranchInfo() {
  try {
    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.id);
    return rows;
  } catch {
    return [];
  }
}

export type LegalSectionLink = { id: string; label: string };

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  lastUpdated?: string;
  /** Eyebrow above the title. Defaults to the legal-document wording. */
  eyebrow?: string;
  /**
   * Drives the "On this page" rail. Each `id` must match a `LegalSection` id in
   * `children` — the rail is server-rendered from this list rather than read out
   * of the DOM, so a mismatch is a dead link, not a missing one.
   */
  sections?: LegalSectionLink[];
  /** Suppresses this page's own card in the "Related pages" row. */
  currentPath?: string;
};

const RELATED_PAGES = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund", label: "Refund Policy" },
  { href: "/contact", label: "Contact Us" },
];

export default async function LegalLayout({
  title,
  subtitle,
  children,
  lastUpdated,
  eyebrow = "Legal Information",
  sections = [],
  currentPath,
}: Props) {
  const allBranches = await getBranchInfo();
  const updateDate =
    lastUpdated ||
    new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const related = RELATED_PAGES.filter((p) => p.href !== currentPath);

  // The rail only exists for a document with several sections. Gate the grid on
  // the same condition: with `lg:grid` but no <aside>, the content would be
  // placed in the first (13rem) column and squeezed to a sliver on desktop.
  const hasToc = sections.length > 1;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ============ NAVBAR ============ */}
      <nav className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 md:gap-3">
            <img
              src="/images/brothers-gym-logo.svg"
              alt="Brothers Gym logo"
              className="h-10 w-10 md:h-12 md:w-12 rounded-full object-cover"
            />
            <span className="text-lg md:text-2xl font-black uppercase tracking-widest text-white">
              Brothers<span className="text-yellow-500">Gym</span>
            </span>
          </Link>

          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-yellow-500 transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Back to Home</span>
          </Link>
        </div>
      </nav>

      {/* ============ HEADER ============ */}
      {/* Deliberately compact. These are documents, not landing pages — a 24rem
          marketing hero pushed the first line of actual policy below the fold on
          a phone, which is most of why the pages read as promotional rather than
          official. */}
      <header className="relative border-b border-zinc-800 px-4 md:px-6 py-10 md:py-14 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-yellow-500/10 via-transparent to-transparent"></div>

        <div className="max-w-4xl mx-auto relative z-10 text-center">
          <p className="text-yellow-500 text-[10px] md:text-xs font-black tracking-[0.4em] uppercase mb-3">
            {eyebrow}
          </p>
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight mb-3 text-balance">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm md:text-base text-zinc-400 max-w-2xl mx-auto text-pretty">
              {subtitle}
            </p>
          )}

          {/* Document metadata. `Applies to` is derived from the branch rows so a
              third branch can never be added without it showing up here. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-500">
            <span>
              Last updated <span className="text-zinc-300">{updateDate}</span>
            </span>
            {allBranches.length > 0 && (
              <>
                <span aria-hidden className="text-zinc-700">
                  &bull;
                </span>
                <span>
                  Applies to{" "}
                  <span className="text-zinc-300">
                    {allBranches.map((b) => b.name).join(" & ")}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ============ CONTENT ============ */}
      <section className="py-10 md:py-14 px-4 md:px-6">
        <div
          className={`max-w-5xl mx-auto ${
            hasToc ? "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10 lg:items-start" : ""
          }`}
        >
          {/* Contents rail. Desktop only — on a phone it collapses to the
              disclosure below, so the first section is still the first thing
              under the header. */}
          {hasToc && (
            <aside className="hidden lg:block">
              <nav aria-label="On this page" className="sticky top-28">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  On this page
                </p>
                <ul className="border-l border-zinc-800">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="-ml-px block border-l border-transparent py-1.5 pl-3 text-[13px] leading-snug text-zinc-500 transition-colors hover:border-yellow-500 hover:text-yellow-500"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}

          <div className="min-w-0">
            {hasToc && (
              <details className="lg:hidden not-prose mb-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 group">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400 [&::-webkit-details-marker]:hidden">
                  On this page
                  <ChevronDown
                    size={16}
                    className="text-zinc-500 transition-transform group-open:rotate-180"
                  />
                </summary>
                <ul className="border-t border-zinc-800 px-4 py-3 space-y-0.5">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="block py-1 text-sm text-zinc-400 hover:text-yellow-500 transition-colors"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="prose prose-invert max-w-none">{children}</div>

            {/* Legal Nav Between Pages */}
            <div className="mt-14 pt-6 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mb-3">
                Related pages
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {related.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs font-bold text-zinc-300 transition-colors hover:border-yellow-500/40 hover:text-yellow-500"
                  >
                    {p.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ OWNER CONTACT SECTION ============ */}
      <section className="py-14 px-4 md:px-6 border-t border-zinc-900 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <p className="text-yellow-500 text-xs font-black tracking-[0.4em] uppercase mb-3">
              Contact The Owners
            </p>
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">
              Questions? <span className="text-yellow-500">Talk to us directly.</span>
            </h2>
            <p className="text-zinc-400 text-sm mt-3 max-w-xl mx-auto">
              For any legal, membership, or payment questions, contact the branch owner
              directly.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 md:gap-6">
            {allBranches.map((branch) => (
              <div
                key={branch.id}
                className="bg-zinc-900 border border-zinc-800 hover:border-yellow-500/40 rounded-2xl p-6 transition-colors"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-yellow-500/20 border border-yellow-500/30 rounded-xl flex items-center justify-center">
                    <Building2 size={20} className="text-yellow-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase">
                      {branch.name}
                    </h3>
                    <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                      Branch &middot; {branch.code}
                    </span>
                  </div>
                </div>

                {branch.ownerName && (
                  <div className="mb-3 pb-3 border-b border-zinc-800">
                    <p className="text-xs text-zinc-500 mb-1">Owner</p>
                    <p className="text-white font-bold">{branch.ownerName}</p>
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  {branch.phone && (
                    <a
                      href={`tel:${branch.phone}`}
                      className="flex items-center gap-2 text-zinc-300 hover:text-yellow-500 transition-colors"
                    >
                      <Phone size={14} className="text-yellow-500 shrink-0" />
                      <span>{branch.phone}</span>
                    </a>
                  )}
                  {branch.ownerEmail && (
                    <a
                      href={`mailto:${branch.ownerEmail}`}
                      className="flex items-center gap-2 text-zinc-300 hover:text-yellow-500 transition-colors break-all"
                    >
                      <Mail size={14} className="text-yellow-500 shrink-0" />
                      <span>{branch.ownerEmail}</span>
                    </a>
                  )}
                  <div className="flex items-start gap-2 text-zinc-400 pt-2">
                    <MapPin size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                    <span className="text-xs leading-relaxed">{branch.address}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="py-8 px-4 md:px-6 border-t border-zinc-900 bg-zinc-950">
        <div className="max-w-4xl mx-auto text-center space-y-3">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img
              src="/images/brothers-gym-logo.svg"
              alt="Brothers Gym"
              className="h-8 w-8 rounded-full"
            />
            <span className="text-sm font-black uppercase tracking-widest text-white">
              Brothers<span className="text-yellow-500">Gym</span>
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            &copy; {new Date().getFullYear()} Brothers Gym. All rights reserved.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-zinc-500">
            {RELATED_PAGES.map((p) => (
              <Link key={p.href} href={p.href} className="hover:text-yellow-500 transition-colors">
                {p.label.split(" ")[0]}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
