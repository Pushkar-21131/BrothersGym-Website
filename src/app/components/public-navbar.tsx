"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import PublicMobileMenu from "./public-mobile-menu";

// The bar sits ON TOP of the hero video/poster. At the very top it's fully
// transparent so it merges into the footage; as you scroll down it darkens
// into a solid scrim, reaching full opacity over the dark page body below.
const FADE_DISTANCE = 320; // px of scroll over which the scrim fades IN
const BG = "9, 9, 11"; // zinc-950
const BORDER = "39, 39, 42"; // zinc-800

export default function PublicNavbar() {
  // 0 = fully transparent (at the very top) … 1 = solid dark scrim (scrolled).
  // Start at 0 so the server render and first client paint agree (no flash),
  // then sync to the real scroll position on mount.
  const [scrim, setScrim] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const compute = () => {
      frame.current = null;
      setScrim(Math.min(1, Math.max(0, window.scrollY / FADE_DISTANCE)));
    };
    const onScroll = () => {
      // Coalesce bursts of scroll events into one update per animation frame.
      if (frame.current == null) frame.current = requestAnimationFrame(compute);
    };

    compute(); // reload / back-nav can land mid-page — reflect that immediately
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, []);

  // While the mobile menu is open, force the bar solid so the dropdown (which
  // starts just below it) reads as one attached surface, whatever the scroll.
  const s = menuOpen ? 1 : scrim;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-40 transition-colors duration-200"
      style={{
        backgroundColor: `rgba(${BG}, ${0.9 * s})`,
        backdropFilter: `blur(${(12 * s).toFixed(2)}px)`,
        WebkitBackdropFilter: `blur(${(12 * s).toFixed(2)}px)`,
        borderBottom: `1px solid rgba(${BORDER}, ${0.8 * s})`,
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-20 flex items-center justify-between gap-2 md:gap-3">
        <Link href="/" className="flex items-center gap-2 md:gap-3 min-w-0 shrink">
          <img
            src="/images/brothers-gym-logo.svg"
            alt="Brothers Gym logo"
            className="h-9 w-9 sm:h-10 sm:w-10 md:h-12 md:w-12 rounded-full object-cover shrink-0"
          />
          <span className="text-sm tracking-tight sm:text-lg sm:tracking-widest md:text-2xl font-black uppercase text-white truncate">
            Brothers<span className="text-yellow-500">Gym</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-semibold tracking-wide text-zinc-300">
          <a href="#about" className="hover:text-yellow-500 transition-colors">ABOUT</a>
          <a href="#bmi" className="hover:text-yellow-500 transition-colors">BMI</a>
          <a href="#reviews" className="hover:text-yellow-500 transition-colors">REVIEWS</a>
          <a href="#staff" className="hover:text-yellow-500 transition-colors">TRAINERS</a>
          <a href="#locations" className="hover:text-yellow-500 transition-colors">LOCATIONS</a>
          <a href="#contact" className="hover:text-yellow-500 transition-colors">CONTACT</a>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <Link
            href="/join"
            className="text-[10px] md:text-xs font-black uppercase tracking-wider bg-yellow-500 text-black hover:bg-yellow-400 px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Join Now
          </Link>
          <PublicMobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
        </div>
      </div>
    </nav>
  );
}
