import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  Users,
  UserCircle,
  Wrench,
  LayoutDashboard,
  Briefcase,
  MessageCircle,
  Upload,
  KeyRound,
  Shield,
  Star,
  UserX,
  Tag,
  Building2,
  Inbox,
} from "lucide-react";
import { db } from "@/db";
import { onlineJoins } from "@/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { getAllBranches } from "@/lib/branch";
import { hasPermission, getCurrentUser } from "@/lib/auth-check";
import BranchSwitcher from "./branch-switcher";
import LogoutButton from "./logout-button";
import AdminShell, { AdmNavLink } from "./admin-shell";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin | Brothers Gym",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * viewport-fit=cover lets the fixed top bar and tab bar paint into the notch
 * and home-indicator areas; the CSS then pads them back with env(safe-area-*).
 * Without it those bars sit inside a letterboxed viewport on an iPhone.
 */
export const viewport: Viewport = {
  themeColor: "#050506",
  viewportFit: "cover",
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getCurrentUser();
  const role = user?.role || "owner";
  const name = user?.name || "Admin";
  const activeBranchCookie = cookieStore.get("admin_branch")?.value || "all";
  const isOwner = role === "owner";

  const branches = await getAllBranches();
  const currentBranchId: number | "all" =
    activeBranchCookie === "all" ? "all" : Number(activeBranchCookie);

  // 🔒 Permission checks — computed once for the whole navigation.
  // The dashboard is not among them: it is owner-only, so `isOwner` gates it
  // directly. A staff account with dashboard.canView used to reach /admin and
  // hit a runtime error there, so the entry points are gone for everyone but
  // the owner.
  const canSeeMembers = isOwner || (await hasPermission("members", "canView"));
  const canSeeReminders =
    isOwner || (await hasPermission("reminders", "canView"));
  const canSeeEquipment =
    isOwner || (await hasPermission("equipment", "canView"));
  const canSeeImport = isOwner || (await hasPermission("import", "canView"));
  const canSeeSecurity =
    isOwner || (await hasPermission("security", "canView"));
  const canSeeTrainers =
    isOwner || (await hasPermission("trainers", "canView"));
  const canSeeStaff = isOwner || (await hasPermission("staff", "canView"));
  const canSeeReviews = isOwner || (await hasPermission("reviews", "canView"));

  // Badge on the owner's "Join Requests" nav: how many online joins are still
  // awaiting action (paid-but-unconfirmed or not-yet-paid) in the current view.
  // Wrapped so a DB hiccup can never take down the whole admin shell.
  let pendingJoinCount = 0;
  if (isOwner) {
    try {
      const statusFilter = inArray(onlineJoins.status, ["pending", "claimed"]);
      const rows = await db
        .select({ c: count() })
        .from(onlineJoins)
        .where(
          currentBranchId === "all"
            ? statusFilter
            : and(statusFilter, eq(onlineJoins.branchId, currentBranchId))
        );
      pendingJoinCount = Number(rows[0]?.c ?? 0);
    } catch {
      pendingJoinCount = 0;
    }
  }

  const activeBranch =
    currentBranchId === "all"
      ? null
      : branches.find((b) => b.id === currentBranchId);
  const branchLabel = activeBranch ? activeBranch.name : "All Branches";
  // The top bar has to fit the wordmark and the branch indicator on a narrow
  // phone, so the pill shows the branch code ("NR", "SP") rather than the full
  // name. branchLabel still goes on the title attribute, and the drawer's
  // branch switcher spells every name out in full.
  const branchShort = activeBranch ? activeBranch.code : "All";

  const branchOptions = branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
  }));

  return (
    <div className="adm">
      <AdminShell
        name={name}
        branchLabel={branchLabel}
        branchShort={branchShort}
        tabs={{
          members: canSeeMembers,
          inactive: canSeeMembers,
          staff: canSeeStaff,
        }}
        footer={<LogoutButton className="adm-logout" iconSize={17} />}
      >
        <div className="adm-sec">Active Branch</div>
        <BranchSwitcher
          branches={branchOptions}
          currentBranchId={currentBranchId}
          isOwner={isOwner}
        />

        <div className="adm-sec">Daily</div>
        {isOwner && (
          <AdmNavLink href="/admin" icon={<LayoutDashboard size={17} />} exact>
            Dashboard
          </AdmNavLink>
        )}
        {isOwner && (
          <AdmNavLink
            href="/admin/join-requests"
            icon={<Inbox size={17} />}
            count={pendingJoinCount}
          >
            Join Requests
          </AdmNavLink>
        )}
        {canSeeMembers && (
          <>
            <AdmNavLink href="/admin/members" icon={<Users size={17} />}>
              Members
            </AdmNavLink>
            <AdmNavLink href="/admin/inactive" icon={<UserX size={17} />}>
              Inactive Members
            </AdmNavLink>
          </>
        )}
        {canSeeReminders && (
          <AdmNavLink href="/admin/reminders" icon={<MessageCircle size={17} />}>
            Reminders
          </AdmNavLink>
        )}
        {canSeeEquipment && (
          <AdmNavLink href="/admin/equipment" icon={<Wrench size={17} />}>
            Equipment
          </AdmNavLink>
        )}
        {canSeeImport && (
          <AdmNavLink href="/admin/import" icon={<Upload size={17} />}>
            Import Excel
          </AdmNavLink>
        )}

        {(canSeeTrainers ||
          canSeeStaff ||
          canSeeReviews ||
          canSeeSecurity ||
          isOwner) && <div className="adm-sec">Management</div>}

        {canSeeStaff && (
          <AdmNavLink href="/admin/staff" icon={<Briefcase size={17} />}>
            Staff
          </AdmNavLink>
        )}
        {canSeeTrainers && (
          <AdmNavLink href="/admin/trainers" icon={<UserCircle size={17} />}>
            Trainers
          </AdmNavLink>
        )}
        {canSeeReviews && (
          <AdmNavLink href="/admin/reviews" icon={<Star size={17} />}>
            Reviews
          </AdmNavLink>
        )}
        {isOwner && (
          <>
            <AdmNavLink href="/admin/plans" icon={<Tag size={17} />}>
              Plans &amp; Pricing
            </AdmNavLink>
            <AdmNavLink href="/admin/branch" icon={<Building2 size={17} />}>
              Branch Info
            </AdmNavLink>
            <AdmNavLink href="/admin/users" icon={<KeyRound size={17} />}>
              Staff Logins
            </AdmNavLink>
          </>
        )}
        {canSeeSecurity && (
          <AdmNavLink href="/admin/security" icon={<Shield size={17} />}>
            Security
          </AdmNavLink>
        )}
      </AdminShell>

      {/* .adm-page is the centred content column. On a phone it does nothing;
          on a laptop it caps the line length so text does not run the full
          width of a 27-inch monitor. */}
      <main className="adm-main">
        <div className="adm-page">{children}</div>
      </main>
    </div>
  );
}
