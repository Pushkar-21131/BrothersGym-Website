import { db } from "@/db";
import { enquiries, branches } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import EnquiryList, { type Enquiry } from "./enquiry-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function EnquiriesPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("enquiries", "canView");
    if (!canView) redirect("/admin/members");
  }

  const canAdd = role === "owner" || (await hasPermission("enquiries", "canAdd"));
  const canEdit = role === "owner" || (await hasPermission("enquiries", "canEdit"));
  const canDelete =
    role === "owner" || (await hasPermission("enquiries", "canDelete"));
  const canSendWhatsApp =
    role === "owner" || (await hasPermission("enquiries", "canSendWhatsApp"));

  const scope = await getBranchScope();

  // Column list, not select() — the annotation below would accept a wider row
  // silently, which is how the reminders page once shipped every member's
  // address to the browser.
  const enquiriesQuery: Promise<Enquiry[]> = db
    .select({
      id: enquiries.id,
      branchId: enquiries.branchId,
      name: enquiries.name,
      sex: enquiries.sex,
      phone: enquiries.phone,
      inquiryDate: enquiries.inquiryDate,
      note: enquiries.note,
      status: enquiries.status,
      followUpDate: enquiries.followUpDate,
      lastContactedAt: enquiries.lastContactedAt,
      contactCount: enquiries.contactCount,
      convertedMemberId: enquiries.convertedMemberId,
      createdAt: enquiries.createdAt,
      branchCode: branches.code,
    })
    .from(enquiries)
    .leftJoin(branches, eq(enquiries.branchId, branches.id))
    .where(
      scope.type === "single"
        ? eq(enquiries.branchId, scope.branchId)
        : inArray(enquiries.branchId, scope.branchIds)
    )
    .orderBy(desc(enquiries.createdAt));

  const [allBranches, rows] = await Promise.all([getAllBranches(), enquiriesQuery]);

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Enquiries</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {rows.length} total
        </p>
      </div>
      <EnquiryList
        initialEnquiries={rows}
        showBranchColumn={showBranchColumn}
        branches={allBranches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        currentBranchId={scope.type === "single" ? scope.branchId : null}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        canSendWhatsApp={canSendWhatsApp}
      />
    </>
  );
}
