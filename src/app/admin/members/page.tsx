import { db } from "@/db";
import { members, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import MemberList from "./member-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission, getHiddenFields } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  // Members module — everyone should have at least canView typically
  if (role !== "owner") {
    const canView = await hasPermission("members", "canView");
    if (!canView) redirect("/admin/reminders"); // fallback destination
  }

  // Determine what this user can do (owner = all true)
  const canAdd = role === "owner" || (await hasPermission("members", "canAdd"));
  const canEdit = role === "owner" || (await hasPermission("members", "canEdit"));
  const canDelete = role === "owner" || (await hasPermission("members", "canDelete"));
  const hiddenFields = role === "owner" ? [] : await getHiddenFields("members");

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const rows = await db
    .select({
      id: members.id,
      branchId: members.branchId,
      gymId: members.gymId,
      name: members.name,
      email: members.email,
      contactNumber: members.contactNumber,
      address: members.address,
      parentName: members.parentName,
      emergencyContact: members.emergencyContact,
      feeAmount: members.feeAmount,
      joiningDate: members.joiningDate,
      membershipExpiry: members.membershipExpiry,
      leftGym: members.leftGym,
      createdAt: members.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(members)
    .leftJoin(branches, eq(members.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(members.branchId, scope.branchId)
        : inArray(members.branchId, scope.branchIds)
    )
    .orderBy(desc(members.createdAt));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Members</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} total
        </p>
      </div>
      <MemberList
        initialMembers={rows as any}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        hiddenFields={hiddenFields}
      />
    </>
  );
}