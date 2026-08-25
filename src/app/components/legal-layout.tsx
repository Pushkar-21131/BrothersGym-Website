import Link from "next/link";
import { ArrowLeft, MapPin, Phone, Mail, Building2 } from "lucide-react";
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

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  lastUpdated?: string;
};

export default async function LegalLayout({
  title,
  subtitle,
  children,
  lastUpdated,
}: Props) {
  const allBranches = await getBranchInfo();
  const updateDate =
    lastUpdated ||
    new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

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

      {/* ============ HERO ============ */}
      <section className="relative py-16 md:py-24 px-4 md:px-6 border-b border-zinc-800 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-yellow-500/10 via-transparent to-transparent"></div>

        <div className="max-w-4xl mx-auto relative z-10 text-center">
          <p className="text-yellow-500 text-xs md:text-sm font-black tracking-[0.4em] uppercase mb-3">
            — Legal Information —
          </p>
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight mb-4">
            {title}
          </h1>
          {subtitle && (
            <p className="text-base md:text-lg text-zinc-400 max-w-2xl mx-auto">
              {subtitle}
            </p>
          )}
          <p className="text-xs text-zinc-500 mt-6">
            Last updated: <span className="text-zinc-300 font-medium">{updateDate}</span>
          </p>
        </div>
      </section>

      {/* ============ CONTENT ============ */}
      <section className="py-12 md:py-16 px-4 md:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="prose prose-invert max-w-none">{children}</div>

          {/* Legal Nav Between Pages */}
          <div className="mt-16 pt-8 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-4 text-center">
              Related Legal Pages
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <LegalNavCard href="/privacy" label="Privacy Policy" />
              <LegalNavCard href="/terms" label="Terms & Conditions" />
              <LegalNavCard href="/refund" label="Refund Policy" />
              <LegalNavCard href="/contact" label="Contact Us" />
            </div>
          </div>
        </div>
      </section>

      {/* ============ OWNER CONTACT SECTION ============ */}
      <section className="py-16 px-4 md:px-6 border-t border-zinc-900 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-yellow-500 text-xs font-black tracking-[0.4em] uppercase mb-3">
              — Contact The Owners —
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
                      Branch · {branch.code}
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
            <Link href="/privacy" className="hover:text-yellow-500 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-yellow-500 transition-colors">
              Terms
            </Link>
            <Link href="/refund" className="hover:text-yellow-500 transition-colors">
              Refund
            </Link>
            <Link href="/contact" className="hover:text-yellow-500 transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LegalNavCard({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="bg-zinc-900 border border-zinc-800 hover:border-yellow-500/40 hover:bg-yellow-500/5 rounded-lg p-3 text-center text-xs font-bold text-zinc-300 hover:text-yellow-500 transition-all"
    >
      {label}
    </Link>
  );
}