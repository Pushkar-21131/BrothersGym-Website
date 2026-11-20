"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import PublicMobileMenu from "./public-mobile-menu";

const FADE_DISTANCE = 320;

export default function PublicNavbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame: number | null = null;
    let previous = -1;
    const compute = () => {
      frame = null;
      const progress = Math.min(1, Math.max(0, window.scrollY / FADE_DISTANCE));
      if (progress !== previous) {
        // Update the scrim without re-rendering the navigation on scroll.
        navRef.current?.style.setProperty("--nav-progress", String(progress));
        previous = progress;
      }
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  const home = usePathname() === "/" ? "" : "/";

  return (
    <nav ref={navRef} aria-label="Main navigation" data-menu-open={menuOpen} className="public-navbar fixed top-0 left-0 right-0 z-40">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-20 flex items-center justify-between gap-2 md:gap-3">
        <Link href="/" className="flex items-center gap-1.5 sm:gap-2 xl:gap-3 min-w-0" aria-label="Brothers Gym home">
          <img src="/images/brothers-gym-logo.svg" alt="" width={44} height={44} className="h-8 w-8 sm:h-10 sm:w-10 xl:h-11 xl:w-11 rounded-full object-cover shrink-0" />
          <span translate="no" className="text-xs sm:text-lg xl:text-xl font-black uppercase tracking-tight sm:tracking-wide text-white truncate">
            Brothers<span className="text-yellow-500">Gym</span>
          </span>
        </Link>

        <div className="hidden xl:flex items-center gap-5 text-xs font-semibold tracking-wide text-zinc-200 whitespace-nowrap">
          <a href={home + "#about"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">ABOUT</a>
          <a href={home + "#bmi"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">BMI</a>
          <a href={home + "#reviews"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">REVIEWS</a>
          <Link href="/plans" className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">PLANS &amp; FAQ</Link>
          <a href={home + "#staff"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">TRAINERS</a>
          <a href={home + "#locations"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">LOCATIONS</a>
          <a href={home + "#contact"} className="inline-flex min-h-11 items-center hover:text-yellow-500 transition-colors">CONTACT</a>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <Link href="/join" className="min-h-11 inline-flex items-center justify-center text-xs font-black uppercase tracking-wide bg-yellow-500 text-black hover:bg-yellow-400 px-3 sm:px-4 py-3 rounded-lg transition-colors whitespace-nowrap">
            Join Now
          </Link>
          <PublicMobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
        </div>
      </div>
    </nav>
  );
}
