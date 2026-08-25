import { db } from "@/db";
import { equipmentExpenses, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import EquipmentList from "./equipment-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("equipment", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canAdd = role === "owner" || (await hasPermission("equipment", "canAdd"));
  const canEdit = role === "owner" || (await hasPermission("equipment", "canEdit"));
  const canDelete = role === "owner" || (await hasPermission("equipment", "canDelete"));

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const rows = await db
    .select({
      id: equipmentExpenses.id,
      branchId: equipmentExpenses.branchId,
      equipmentName: equipmentExpenses.equipmentName,
      cost: equipmentExpenses.cost,
      date: equipmentExpenses.date,
      createdAt: equipmentExpenses.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(equipmentExpenses)
    .leftJoin(branches, eq(equipmentExpenses.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(equipmentExpenses.branchId, scope.branchId)
        : inArray(equipmentExpenses.branchId, scope.branchIds)
    )
    .orderBy(desc(equipmentExpenses.date));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Equipment</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · purchases &amp; servicing
        </p>
      </div>
      <EquipmentList
        initialItems={rows as any}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </>
  );
}