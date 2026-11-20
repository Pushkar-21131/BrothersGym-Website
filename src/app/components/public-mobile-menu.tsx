"use client";

import { useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const NAV_ITEMS = [
  { href: "/plans", label: "Plans & FAQ" },
  { href: "#locations", label: "Locations" },
  { href: "#about", label: "About" },
  { href: "#reviews", label: "Reviews" },
  { href: "#staff", label: "Trainers" },
  { href: "#bmi", label: "BMI Calculator" },
  { href: "#contact", label: "Contact" },
];

export default function PublicMobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const home = usePathname() === "/" ? "" : "/";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const onDesktop = () => { if (desktop.matches) onOpenChange(false); };
    desktop.addEventListener("change", onDesktop);
    return () => desktop.removeEventListener("change", onDesktop);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
    const dismissOutside = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={menuRef} className="xl:hidden relative">
      <button ref={toggleRef} type="button" onClick={() => onOpenChange(!open)} className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 transition-colors" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="public-mobile-navigation">
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panelRef} id="public-mobile-navigation" className="public-navigation-panel fixed right-4 top-[88px] w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-zinc-900 p-2 max-h-[calc(100svh-104px)] overflow-y-auto overscroll-contain">
          {NAV_ITEMS.map((item) => {
            const className = "flex min-h-11 items-center px-4 py-3 rounded-lg hover:bg-zinc-800 text-zinc-200 hover:text-yellow-500 transition-colors text-sm font-medium";
            return item.href.startsWith("#") ? (
              <a key={item.href} href={home + item.href} onClick={() => onOpenChange(false)} className={className}>{item.label}</a>
            ) : (
              <Link key={item.href} href={item.href} onClick={() => onOpenChange(false)} className={className}>{item.label}</Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
