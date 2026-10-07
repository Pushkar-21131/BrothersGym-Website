import Link from "next/link";
import { ArrowRight, Building2, MapPin, Phone, Clock } from "lucide-react";
import type { PublicBranch } from "@/lib/public-data";

/**
 * The site footer, shared by the homepage and /plans.
 *
 * It carries `id="contact"` and the nested `id="locations"` on purpose: the
 * navbar's CONTACT and LOCATIONS links are anchors, so those two ids have to
 * exist on every page the navbar renders on — not just the homepage, which is
 * where they used to live because the footer did.
 */
export default function PublicFooter({ branches }: { branches: PublicBranch[] }) {
  return (
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
          {branches.map((branch) => (
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
              <Link href="/plans" className="hover:text-yellow-500 transition-colors">Plans &amp; FAQ</Link>
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
  );
}
