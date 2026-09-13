import { db } from "@/db";
import { membershipPlans, branches } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireOwner } from "@/lib/auth-check";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import PlansEditorClient, { type Plan } from "./plans-editor-client";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  await requireOwner();

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const rows: Plan[] = await db
    .select({
      id: membershipPlans.id,
      branchId: membershipPlans.branchId,
      name: membershipPlans.name,
      code: membershipPlans.code,
      price: membershipPlans.price,
      durationDays: membershipPlans.durationDays,
      description: membershipPlans.description,
      includesCardio: membershipPlans.includesCardio,
      isActive: membershipPlans.isActive,
      displayOrder: membershipPlans.displayOrder,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(membershipPlans)
    .leftJoin(branches, eq(membershipPlans.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(membershipPlans.branchId, scope.branchId)
        : inArray(membershipPlans.branchId, scope.branchIds)
    )
    .orderBy(membershipPlans.branchId, membershipPlans.displayOrder);

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Plans</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · prices shown on the join page
        </p>
      </div>
      <PlansEditorClient
        initialPlans={rows}
        allBranches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
      />
    </>
  );
}