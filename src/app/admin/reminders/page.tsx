import { db } from "@/db";
import { members } from "@/db/schema";
import { asc, eq, inArray, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import ReminderPanel, { type Member } from "./reminder-panel";
import { getBranchScope } from "@/lib/branch";
import { getVerifiedRole, hasPermission } from "@/lib/auth-check";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  if (role !== "owner") {
    const canView = await hasPermission("reminders", "canView");
    if (!canView) redirect("/admin/members");
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

  const expiring = allMembers.filter((m) => new Date(m.membershipExpiry) <= in7);

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
        members={allMembers}
        expiringMembers={expiring}
        role={role}
        canSendWhatsApp={canSendWhatsApp}
        canSendSMS={canSendSMS}
      />
    </>
  );
}