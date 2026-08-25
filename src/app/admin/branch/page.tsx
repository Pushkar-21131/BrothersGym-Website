import { db } from "@/db";
import { branches } from "@/db/schema";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import BranchesClient from "./branches-client";
import { getVerifiedRole } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const role = await getVerifiedRole();
  if (role !== "owner") redirect("/admin/members");

  const allBranches = await db.select().from(branches).orderBy(desc(branches.createdAt));

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Branches</h1>
        <p className="adm-sub">
          Edits show on the public site straight away
        </p>
      </div>
      <BranchesClient initialBranches={allBranches} />
    </>
  );
}