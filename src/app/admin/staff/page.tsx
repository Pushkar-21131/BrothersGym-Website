import { db } from "@/db";
import { staff, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import StaffList from "./staff-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("staff", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canEdit = role === "owner" || (await hasPermission("staff", "canEdit"));

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const rows = await db
    .select({
      id: staff.id,
      branchId: staff.branchId,
      name: staff.name,
      category: staff.category,
      salary: staff.salary,
      contactNumber: staff.contactNumber,
      address: staff.address,
      joinDate: staff.joinDate,
      isActive: staff.isActive,
      createdAt: staff.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(staff)
    .leftJoin(branches, eq(staff.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(staff.branchId, scope.branchId)
        : inArray(staff.branchId, scope.branchIds)
    )
    .orderBy(desc(staff.createdAt));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Staff</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} on the books
        </p>
      </div>
      <StaffList
        initialStaff={rows as any}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canEdit={canEdit}
      />
    </>
  );
}