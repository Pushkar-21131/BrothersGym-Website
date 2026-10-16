import { db } from "@/db";
import { enquiries, branches } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import EnquiryList, { type Enquiry } from "./enquiry-list";
import { getBranchScope, getAllBranches } from "@/lib/branch";
import {
  getVerifiedRole,
  hasPermission,
  hasModulePageAccess,
  getCurrentUser,
  getFirstAllowedAdminPath,
} from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function EnquiriesPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  // Enquiries can be used add-only: an account with Add and no View reaches this
  // page and sees back only the rows it wrote. Same predicate as the sidebar
  // link and getFirstAllowedAdminPath, so the nav and the guard cannot disagree.
  if (!(await hasModulePageAccess("enquiries"))) {
    redirect(await getFirstAllowedAdminPath());
  }

  const canView = role === "owner" || (await hasPermission("enquiries", "canView"));
  const canAdd = role === "owner" || (await hasPermission("enquiries", "canAdd"));
  const canEdit = role === "owner" || (await hasPermission("enquiries", "canEdit"));
  const canDelete =
    role === "owner" || (await hasPermission("enquiries", "canDelete"));
  const canSendWhatsApp =
    role === "owner" || (await hasPermission("enquiries", "canSendWhatsApp"));

  const scope = await getBranchScope();
  const me = await getCurrentUser();

  // `-1` is not a serial id, so a null viewer matches nothing rather than
  // everything. It cannot happen — a null id means the env-based owner, who
  // always has canView — but the restrictive direction is the one to fail in.
  const ownOnly = !canView;
  const ownClause = ownOnly
    ? eq(enquiries.createdByUserId, me?.id ?? -1)
    : undefined;

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
      createdByName: enquiries.createdByName,
      createdAt: enquiries.createdAt,
      branchCode: branches.code,
    })
    .from(enquiries)
    .leftJoin(branches, eq(enquiries.branchId, branches.id))
    .where(
      and(
        scope.type === "single"
          ? eq(enquiries.branchId, scope.branchId)
          : inArray(enquiries.branchId, scope.branchIds),
        ownClause
      )
    )
    .orderBy(desc(enquiries.createdAt));

  const [allBranches, rows] = await Promise.all([getAllBranches(), enquiriesQuery]);

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";
  const showBranchColumn = scope.type === "all" && allBranches.length > 1;

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Enquiries</h1>
        {/* A branch-wide count is itself a disclosure, so add-only says whose
            list this is instead of how big the gym's is. */}
        <p className="adm-sub">
          {ownOnly ? (
            <>Your entries · {rows.length}</>
          ) : (
            <>
              <strong>{scopeLabel}</strong> · {rows.length} total
            </>
          )}
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
        ownOnly={ownOnly}
      />
    </>
  );
}
