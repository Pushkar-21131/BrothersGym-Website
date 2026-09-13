import { db } from "@/db";
import { appUsers, branches } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth-check";
import { getAllBranches, getBranchScope, isSuperAdmin } from "@/lib/branch";
import StaffLoginsClient, { type User } from "./staff-logins-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireOwner();

  // requireOwner() only proves the caller has the owner ROLE — a branch-scoped
  // owner passes it. So the list itself has to be scoped, or the SP owner would
  // read the NR owner's login email here (and the Edit button would offer to
  // reset its password; actions/auth.ts refuses, but the row should not be
  // visible in the first place).
  const superAdmin = await isSuperAdmin();
  const scope = await getBranchScope();
  const myBranchId = scope.type === "single" ? scope.branchId : null;

  const rows: User[] = await db
    .select({
      id: appUsers.id,
      branchId: appUsers.branchId,
      name: appUsers.name,
      email: appUsers.email,
      role: appUsers.role,
      isActive: appUsers.isActive,
      permissions: appUsers.permissions,
      createdAt: appUsers.createdAt,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(appUsers)
    .leftJoin(branches, eq(appUsers.branchId, branches.id))
    .where(
      superAdmin
        ? undefined
        : // Own branch, staff only. Owner rows stay hidden even when they are in
          // this branch: a branch owner cannot administer any owner login (see
          // assertCanAdministerUser), so showing their own row would only offer
          // buttons that refuse.
          and(
            eq(appUsers.role, "staff"),
            eq(appUsers.branchId, myBranchId ?? -1)
          )
    );

  // A branch owner only ever assigns their own branch, so that is the only one
  // they are offered. The server forces it regardless of what is posted.
  const allBranches = await getAllBranches();
  const assignableBranches = superAdmin
    ? allBranches
    : allBranches.filter((b) => b.id === myBranchId);

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Logins</h1>
        <p className="adm-sub">
          {rows.length} account{rows.length === 1 ? "" : "s"} ·{" "}
          {superAdmin
            ? "staff are locked to one branch"
            : `staff for ${scope.type === "single" ? scope.branchName : "your gym"}`}
        </p>
      </div>
      <StaffLoginsClient
        initialUsers={rows}
        branches={assignableBranches.map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
        }))}
        canManageOwners={superAdmin}
        lockedBranchName={
          superAdmin || scope.type !== "single" ? null : scope.branchName
        }
      />
    </>
  );
}
