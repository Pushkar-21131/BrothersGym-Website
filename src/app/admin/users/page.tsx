import { db } from "@/db";
import { appUsers, branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth-check";
import { getAllBranches } from "@/lib/branch";
import StaffLoginsClient from "./staff-logins-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireOwner();

  const rows = await db
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
    .leftJoin(branches, eq(appUsers.branchId, branches.id));

  const allBranches = await getAllBranches();

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Logins</h1>
        <p className="adm-sub">
          {rows.length} account{rows.length === 1 ? "" : "s"} · staff are locked to
          one branch
        </p>
      </div>
      <StaffLoginsClient
        initialUsers={rows as any}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
      />
    </>
  );
}