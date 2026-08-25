"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, UserX, Briefcase, MoreHorizontal } from "lucide-react";

export type TabKey = "members" | "inactive" | "staff";

type Props = {
  /** Which tabs this user is allowed to see, from the layout's permission checks. */
  allowed: Record<TabKey, boolean>;
  /** Count badges — expiring memberships and inactive members. */
  badges?: Partial<Record<TabKey, number>>;
  onMore: () => void;
};

const TABS: {
  key: TabKey;
  href: string;
  label: string;
  icon: typeof Users;
  exact?: boolean;
}[] = [
  { key: "members", href: "/admin/members", label: "Members", icon: Users },
  { key: "inactive", href: "/admin/inactive", label: "Inactive", icon: UserX },
  { key: "staff", href: "/admin/staff", label: "Team", icon: Briefcase },
];

/**
 * Bottom tab bar — the destinations opened most during a shift. Everything
 * else is behind "More", which opens the drawer. The dashboard is deliberately
 * not here: it is owner-only, and an owner reaches it from the sidebar.
 *
 * Hidden above 900px by CSS; the drawer becomes a permanent sidebar there.
 */
export default function AdminTabBar({ allowed, badges = {}, onMore }: Props) {
  const pathname = usePathname();
  const visible = TABS.filter((t) => allowed[t.key]);

  return (
    <nav className="adm-tabbar" aria-label="Main sections">
      {visible.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        const badge = badges[tab.key];

        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`adm-tab${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={19} />
            <span>{tab.label}</span>
            {badge !== undefined && badge > 0 && (
              <span className="adm-tab-badge">{badge > 99 ? "99+" : badge}</span>
            )}
          </Link>
        );
      })}

      <button type="button" className="adm-tab" onClick={onMore}>
        <MoreHorizontal size={19} />
        <span>More</span>
      </button>
    </nav>
  );
}
