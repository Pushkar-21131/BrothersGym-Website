import { db } from "@/db";
import { equipmentExpenses, branches } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import EquipmentList, { type Item } from "./equipment-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import {
  getVerifiedRole,
  hasPermission,
  hasModulePageAccess,
  getCurrentUser,
  getFirstAllowedAdminPath,
} from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  // See the note in admin/enquiries/page.tsx: this module can be used add-only,
  // and hasModulePageAccess is the one predicate the nav and the guard share.
  if (!(await hasModulePageAccess("equipment"))) {
    redirect(await getFirstAllowedAdminPath());
  }

  const canView = role === "owner" || (await hasPermission("equipment", "canView"));
  const canAdd = role === "owner" || (await hasPermission("equipment", "canAdd"));
  const canEdit = role === "owner" || (await hasPermission("equipment", "canEdit"));
  const canDelete = role === "owner" || (await hasPermission("equipment", "canDelete"));

  const scope = await getBranchScope();
  const me = await getCurrentUser();
  const ownOnly = !canView;
  // `-1` is not a serial id, so a null viewer matches nothing rather than
  // everything — the restrictive direction to fail in.
  const ownClause = ownOnly
    ? eq(equipmentExpenses.createdByUserId, me?.id ?? -1)
    : undefined;

  const allBranches = await getAllBranches();

  const rows: Item[] = await db
    .select({
      id: equipmentExpenses.id,
      branchId: equipmentExpenses.branchId,
      equipmentName: equipmentExpenses.equipmentName,
      cost: equipmentExpenses.cost,
      date: equipmentExpenses.date,
      createdByName: equipmentExpenses.createdByName,
      createdAt: equipmentExpenses.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(equipmentExpenses)
    .leftJoin(branches, eq(equipmentExpenses.branchId, branches.id))
    .where(
      and(
        scope.type === "single"
          ? eq(equipmentExpenses.branchId, scope.branchId)
          : inArray(equipmentExpenses.branchId, scope.branchIds),
        ownClause
      )
    )
    .orderBy(desc(equipmentExpenses.date));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Equipment</h1>
        <p className="adm-sub">
          {ownOnly ? (
            <>Your entries · {rows.length}</>
          ) : (
            <>
              <strong>{scopeLabel}</strong> · purchases &amp; servicing
            </>
          )}
        </p>
      </div>
      <EquipmentList
        initialItems={rows}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        ownOnly={ownOnly}
      />
    </>
  );
}