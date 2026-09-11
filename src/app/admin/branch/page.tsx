import { db } from "@/db";
import { branches } from "@/db/schema";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import BranchesClient from "./branches-client";
import { getVerifiedRole } from "@/lib/auth-check";
import { getBranchScope, isSuperAdmin } from "@/lib/branch";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const role = await getVerifiedRole();
  if (role !== "owner") redirect("/admin/members");

  // Each row here holds that gym's public address, phone, owner name, owner
  // email and payee details. A branch owner sees only their own — the write
  // action refuses out-of-scope ids, but the other gym's details should not be
  // readable here either.
  const superAdmin = await isSuperAdmin();
  const scope = await getBranchScope();

  const allBranches = await db
    .select()
    .from(branches)
    .where(
      superAdmin || scope.type !== "single"
        ? undefined
        : eq(branches.id, scope.branchId)
    )
    .orderBy(desc(branches.createdAt));

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">{superAdmin ? "Branches" : "Gym Details"}</h1>
        <p className="adm-sub">Edits show on the public site straight away</p>
      </div>
      <BranchesClient initialBranches={allBranches} canToggleActive={superAdmin} />
    </>
  );
}
