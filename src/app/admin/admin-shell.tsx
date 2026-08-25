"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import AdminTabBar, { type TabKey } from "./admin-tabbar";

type Props = {
  /** Nav links + section headings, rendered inside the drawer. */
  children: ReactNode;
  /** Logout button, pinned to the bottom of the drawer. */
  footer: ReactNode;
  name: string;
  /** Full branch name — the pill's tooltip, and what the sidebar shows. */
  branchLabel: string;
  /** Branch code ("NR", "SP") or "All" — what the narrow top-bar pill shows. */
  branchShort: string;
  /** Which bottom tabs this user may see, from the layout's permission checks. */
  tabs: Record<TabKey, boolean>;
  tabBadges?: Partial<Record<TabKey, number>>;
};

/**
 * Top bar + slide-in drawer for the admin panel.
 *
 * On phones the drawer is the full navigation; the bottom tab bar only covers
 * the five most-used destinations. Above 900px the CSS pins the drawer open as
 * a sidebar and hides the top bar, so this component renders the same markup
 * either way.
 */
export default function AdminShell({
  children,
  footer,
  name,
  branchLabel,
  branchShort,
  tabs,
  tabBadges,
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const touchStartX = useRef<number | null>(null);

  // Close on navigation. Without this the drawer stays open over the new page,
  // because App Router keeps the layout mounted across route changes. Adjusted
  // during render rather than in an effect so the new page never paints once
  // with the old drawer still over it.
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setOpen(false);
  }

  // Escape closes; body scroll locks while the drawer covers the page.
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Swipe left to close. Matches the gesture people already expect from every
  // other app with a left drawer.
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta < -50) setOpen(false);
    touchStartX.current = null;
  }

  return (
    <>
      <header className="adm-topbar">
        <button
          type="button"
          className="adm-burger"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>

        <Link href="/" className="adm-brand" title="Back to website" aria-label="Back to Brothers Gym website">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/brothers-gym-logo.svg"
            alt=""
            className="adm-logo"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="adm-brand-name">
              Brothers<span>Gym</span>
            </div>
            <div className="adm-brand-sub">Admin</div>
          </div>
        </Link>

        {/* The code, not the name — this pill and the wordmark share one
            phone-width row, and the wordmark is the one that cannot shrink
            below legibility. The full name is one tap away in the drawer. */}
        <div className="adm-pill" title={branchLabel}>
          <span className="adm-live" />
          <span className="adm-pill-label">{branchShort}</span>
        </div>
      </header>

      <div
        className={`adm-scrim${open ? " open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <nav
        className={`adm-drawer${open ? " open" : ""}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-label="Admin navigation"
        aria-hidden={undefined}
      >
        <div className="adm-drawer-head">
          {/* Desktop only. The top bar carries the logo on a phone, and it is
              hidden once the drawer is a permanent sidebar — without this the
              panel would have no branding anywhere on a laptop. */}
          <Link href="/" className="adm-drawer-brand" title="Back to website" aria-label="Back to Brothers Gym website">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/brothers-gym-logo.svg"
              alt=""
              className="adm-logo"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="adm-brand-name">
                Brothers<span>Gym</span>
              </div>
              <div className="adm-brand-sub">Admin</div>
            </div>
          </Link>

          <div className="adm-who">
            {/* The gym logo, not the account's initial. A letter in a gold
                disc reads like a placeholder for a missing profile picture,
                and this panel only ever has two or three accounts — whose
                name is already spelled out right next to it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/brothers-gym-logo.svg"
              alt=""
              className="adm-avatar"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="adm-who-name">{name}</div>
            </div>
          </div>
        </div>

        <div className="adm-drawer-scroll">{children}</div>

        <div className="adm-drawer-foot">{footer}</div>
      </nav>

      <AdminTabBar
        allowed={tabs}
        badges={tabBadges}
        onMore={() => setOpen(true)}
      />
    </>
  );
}

/** A single drawer link. Highlights itself when it matches the current route. */
export function AdmNavLink({
  href,
  icon,
  children,
  exact = false,
  count,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  exact?: boolean;
  count?: number;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link href={href} className={`adm-nav${active ? " active" : ""}`}>
      {icon}
      <span>{children}</span>
      {count !== undefined && count > 0 && (
        <span className="adm-nav-count">{count}</span>
      )}
    </Link>
  );
}
