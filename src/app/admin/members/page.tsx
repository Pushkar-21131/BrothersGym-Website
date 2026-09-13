import { db } from "@/db";
import { members, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import MemberList, { type Member } from "./member-list";
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

  // Hidden fields were only hidden in the markup — every value was still sent
  // to the browser in the RSC payload, where devtools or a saved page reads it
  // straight back. The renew modal even pre-filled the fee it was supposed to
  // be concealing.
  //
  // Blanked here, at the boundary, rather than in the client component: that is
  // the one place it cannot be undone by a UI change. Every consumer in
  // member-list.tsx already guards these behind the same `hide()` check, so the
  // blanks are never rendered — and updateMemberAction omits a hidden column
  // from its SET list, so a blank can't be written back over the real value.
  //
  // `address` was missing from this list. It is a declared hideable field —
  // PERMISSION_MODULES lists all five, and the owner's permissions modal offers
  // it as a checkbox — but turning it off did nothing at all: the address was
  // still in the RSC payload, still rendered in its own table column, still in
  // the Excel export, still searchable. Of the five it is arguably the one an
  // owner most wants withheld from a front-desk account.
  //
  // The `Member[]` annotation replaces an `as any` on the prop below. That cast
  // is what let the gap sit here unnoticed: it silenced any shape disagreement
  // between this query and the component that consumes it, so a column dropped,
  // renamed or left un-blanked was a runtime surprise rather than a build error.
  const hidden = new Set(hiddenFields);
  const safeRows: Member[] = hidden.size
    ? rows.map((r) => ({
        ...r,
        feeAmount: hidden.has("feeAmount") ? 0 : r.feeAmount,
        email: hidden.has("email") ? null : r.email,
        address: hidden.has("address") ? null : r.address,
        parentName: hidden.has("parentName") ? null : r.parentName,
        emergencyContact: hidden.has("emergencyContact")
          ? ""
          : r.emergencyContact,
      }))
    : rows;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Members</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} total
        </p>
      </div>
      <MemberList
        initialMembers={safeRows}
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