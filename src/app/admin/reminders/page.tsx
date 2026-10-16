import { db } from "@/db";
import { members } from "@/db/schema";
import { asc, eq, inArray, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import ReminderPanel, { type Member } from "./reminder-panel";
import { getBranchScope } from "@/lib/branch";
import { getVerifiedRole, hasPermission, getFirstAllowedAdminPath, getHiddenFields } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("reminders", "canView");
    if (!canView) redirect(await getFirstAllowedAdminPath());
  }

  // Fine-grained: can this user send WhatsApp / SMS?
  const canSendWhatsApp =
    role === "owner" || (await hasPermission("reminders", "canSendWhatsApp"));
  const canSendSMS =
    role === "owner" || (await hasPermission("reminders", "canSendSMS"));

  const scope = await getBranchScope();

  // Only the columns reminder-panel.tsx reads. `select()` with no column list
  // returned all ~20 and TypeScript accepted the wider object against the
  // panel's six-field `Member`, so nothing flagged it — see the note on that
  // type. The fee stays: it is the amount the member is about to be told they
  // owe, and lib/whatsapp.ts builds the message from it.
  const allMembers: Member[] = await db
    .select({
      id: members.id,
      gymId: members.gymId,
      name: members.name,
      contactNumber: members.contactNumber,
      feeAmount: members.feeAmount,
      membershipExpiry: members.membershipExpiry,
    })
    .from(members)
    .where(
      and(
        eq(members.leftGym, false),
        scope.type === "single"
          ? eq(members.branchId, scope.branchId)
          : inArray(members.branchId, scope.branchIds)
      )
    )
    .orderBy(asc(members.membershipExpiry));

  const today = new Date();
  const in7 = new Date();
  in7.setDate(today.getDate() + 7);

  // A member's phone number is one field, and `members` is where the owner ticks
  // it off — but this page is the second place it is rendered, and hiding it on
  // the members list alone would have left every number readable here. The
  // default staff permissions grant reminders.canView, so that hole would have
  // been the normal case rather than an edge one. Blanked at the boundary like
  // members/page.tsx; lib/whatsapp.ts then reports no dialable number and every
  // send path refuses of its own accord, which is the honest outcome — an
  // account that may not see a number cannot address a message to it.
  const hiddenFields = role === "owner" ? [] : await getHiddenFields("members");
  const hidden = new Set(hiddenFields);
  const safeMembers: Member[] = hidden.has("contactNumber")
    ? allMembers.map((m) => ({ ...m, contactNumber: "" }))
    : allMembers;

  const expiring = safeMembers.filter((m) => new Date(m.membershipExpiry) <= in7);

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Reminders</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · {expiring.length} need chasing
        </p>
      </div>

      <ReminderPanel
        members={safeMembers}
        expiringMembers={expiring}
        role={role}
        canSendWhatsApp={canSendWhatsApp}
        canSendSMS={canSendSMS}
        hiddenFields={hiddenFields}
      />
    </>
  );
}