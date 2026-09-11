import { db } from "@/db";
import { trainers, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import TrainerList from "./trainer-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function TrainersPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("trainers", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canEdit = role === "owner" || (await hasPermission("trainers", "canEdit"));

  const scope = await getBranchScope();
  const allBranches = await getAllBranches();

  const rows = await db
    .select({
      id: trainers.id,
      branchId: trainers.branchId,
      name: trainers.name,
      photoUrl: trainers.photoUrl,
      // photoMime, not photoImage — see the schema comment. This list only needs
      // to know a photo exists so it can build the /api/trainer-photo/[id] src.
      photoMime: trainers.photoMime,
      experience: trainers.experience,
      ptFee: trainers.ptFee,
      isOwner: trainers.isOwner,
      instagramUrl: trainers.instagramUrl,
      createdAt: trainers.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(trainers)
    .leftJoin(branches, eq(trainers.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(trainers.branchId, scope.branchId)
        : inArray(trainers.branchId, scope.branchIds)
    )
    .orderBy(desc(trainers.isOwner), desc(trainers.createdAt));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Trainers</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} on the public site
        </p>
      </div>
      <TrainerList
        initialTrainers={rows}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canEdit={canEdit}
      />
    </>
  );
}