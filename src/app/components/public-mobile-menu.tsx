"use client";

import { useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

// The "#" entries are homepage anchors; PublicNavbar resolves the same list
// against the current path, and both places have to agree.
const NAV_ITEMS = [
  { href: "#about", label: "About" },
  { href: "#bmi", label: "BMI Calculator" },
  { href: "#reviews", label: "Reviews" },
  { href: "/plans", label: "Plans & FAQ" },
  { href: "#staff", label: "Trainers" },
  { href: "#locations", label: "Locations" },
  { href: "#contact", label: "Contact" },
  { href: "/join", label: "Join Online" },
];

// Controlled: the open state lives in PublicNavbar so the bar can force itself
// solid while this menu is open. Behaviour is otherwise unchanged.
export default function PublicMobileMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // On "/" the prefix is empty, so the anchors stay bare and jump in place.
  // Anywhere else they have to point back at the homepage.
  const home = usePathname() === "/" ? "" : "/";

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }

    document.body.style.overflow = "hidden";

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = "";
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={menuRef} className="md:hidden relative">
      {/* p-2 around a 20px icon is a 36px box — under the 44pt tap target the
          admin already holds itself to (.adm-input is min-height:44px). The
          ::after overlay takes the hit area to 44pt while leaving the visible
          button exactly the size it was; padding it up instead would have made
          it visibly taller than the "Join Now" button beside it. */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="relative rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-200 hover:bg-zinc-800 transition-colors after:absolute after:-inset-1 after:content-['']"
        aria-label="Toggle menu"
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            style={{ top: "80px" }}
            onClick={() => onOpenChange(false)}
          />

          <div className="fixed left-0 right-0 mx-4 rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl z-50 max-h-[calc(100vh-100px)] overflow-y-auto"
            style={{ top: "88px" }}
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href.startsWith("#") ? `${home}${item.href}` : item.href}
                onClick={() => onOpenChange(false)}
                className="block px-4 py-3 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-yellow-500 transition-colors text-sm font-medium border-b border-zinc-800 last:border-0"
              >
                {item.label}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
