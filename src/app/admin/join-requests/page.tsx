import { db } from "@/db";
import { onlineJoins, branches, members } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { requireOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { deriveJoinReference, formatDayIST } from "@/lib/manual-join";
import JoinRequestsClient, {
  type JoinRequestRow,
} from "./join-requests-client";

export const dynamic = "force-dynamic";

/** Date + time in IST — computed on the server so the client never re-formats a
 *  Date during render (which would mismatch between SSR and hydration). */
function istDateTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return null;
  }
}

export default async function JoinRequestsPage() {
  await requireOwner();

  const scope = await getBranchScope();

  const rows = await db
    .select({
      id: onlineJoins.id,
      branchId: onlineJoins.branchId,
      name: onlineJoins.name,
      email: onlineJoins.email,
      contactNumber: onlineJoins.contactNumber,
      address: onlineJoins.address,
      planCode: onlineJoins.planCode,
      amount: onlineJoins.amount,
      status: onlineJoins.status,
      upiReference: onlineJoins.upiReference,
      claimedAt: onlineJoins.claimedAt,
      confirmedAt: onlineJoins.confirmedAt,
      createdAt: onlineJoins.createdAt,
      memberId: onlineJoins.memberId,
      branchName: branches.name,
      branchCode: branches.code,
      branchPhone: branches.phone,
      gymId: members.gymId,
      memberExpiry: members.membershipExpiry,
    })
    .from(onlineJoins)
    .leftJoin(branches, eq(onlineJoins.branchId, branches.id))
    .leftJoin(members, eq(onlineJoins.memberId, members.id))
    .where(
      scope.type === "single"
        ? eq(onlineJoins.branchId, scope.branchId)
        : inArray(onlineJoins.branchId, scope.branchIds)
    )
    .orderBy(desc(onlineJoins.createdAt));

  const requests: JoinRequestRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    contactNumber: r.contactNumber,
    address: r.address,
    planCode: r.planCode,
    amount: r.amount,
    status: r.status,
    upiReference: r.upiReference,
    reference: deriveJoinReference(r.branchCode || "", r.id),
    branchName: r.branchName || "",
    branchCode: r.branchCode || "",
    branchPhone: r.branchPhone,
    gymId: r.gymId,
    expiryLabel: r.memberExpiry ? formatDayIST(r.memberExpiry) : null,
    createdLabel: istDateTime(r.createdAt),
    claimedLabel: istDateTime(r.claimedAt),
  }));

  const scopeLabel = scope.type === "single" ? scope.branchName : "All Branches";

  return (
    <>
      <div className="adm-head">
        <h1 className="adm-h1">Join Requests</h1>
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · confirm a UPI payment to activate the
          membership
        </p>
      </div>
      <JoinRequestsClient initialRequests={requests} />
    </>
  );
}
