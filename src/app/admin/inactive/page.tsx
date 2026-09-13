import { db } from "@/db";
import { members, branches } from "@/db/schema";
import { desc, eq, inArray, or, and, lt } from "drizzle-orm";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import InactiveMembersClient, { type Member } from "./inactive-client";
import { redirect } from "next/navigation";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";
import { istDateString } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InactivePage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    // Uses members module permission
    const canView = await hasPermission("members", "canView");
    if (!canView) redirect("/admin/reminders");
  }
  
  const scope = await getBranchScope();
  const allBranches = await getAllBranches();
  const today = istDateString();

  // Fetch expired + left members for the current scope.
  //
  // `email` and `feeAmount` were selected here and never rendered anywhere in
  // inactive-client.tsx — they went into the RSC payload and no further. Both
  // are declared hideable fields (`PERMISSION_MODULES`, members module), and
  // this page gates on `members.canView` but never reads `hiddenFields`, so a
  // staff account with fees hidden had every expired member's fee sitting in the
  // page source. Dropped from the query rather than blanked: the columns aren't
  // used, so there is nothing to configure and nothing to get wrong later.
  const rows: Member[] = await db
    .select({
      id: members.id,
      branchId: members.branchId,
      gymId: members.gymId,
      name: members.name,
      contactNumber: members.contactNumber,
      joiningDate: members.joiningDate,
      membershipExpiry: members.membershipExpiry,
      leftGym: members.leftGym,
      leftGymDate: members.leftGymDate,
      leftGymReason: members.leftGymReason,
      leftGymNote: members.leftGymNote,
      wonBackAt: members.wonBackAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(members)
    .leftJoin(branches, eq(members.branchId, branches.id))
    .where(
      and(
        scope.type === "single"
          ? eq(members.branchId, scope.branchId)
          : inArray(members.branchId, scope.branchIds),
        // Either expired or explicitly left
        or(lt(members.membershipExpiry, today), eq(members.leftGym, true))
      )
    )
    .orderBy(desc(members.membershipExpiry));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Inactive &amp; Left</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} expired or left
        </p>
      </div>
      <InactiveMembersClient
        initialMembers={rows}
        showBranchColumn={showBranchColumn}
      />
    </>
  );
}