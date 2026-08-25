import ImportMembersClient from "./import-members-client";
import { getAllBranches, getBranchScope } from "@/lib/branch";
import { redirect } from "next/navigation";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export default async function ImportPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("import", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canUse = role === "owner" || (await hasPermission("import", "canUse"));

  const branches = await getAllBranches();
  const scope = await getBranchScope();
  const currentBranchId = scope.type === "single" ? scope.branchId : null;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Import</h1>
        <p className="adm-sub">Add members in bulk from your Excel sheet</p>
      </div>

      {!canUse && (
        <section className="adm-card adm-note" style={{ marginBottom: 12 }}>
          <div>
            <p className="adm-note-title">View-only access</p>
            <p className="adm-note-text">
              Ask the owner to turn on &quot;Run import&quot; for your account.
            </p>
          </div>
        </section>
      )}

      <ImportMembersClient
        branches={branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={currentBranchId}
        canUse={canUse}
      />
    </>
  );
}