import { db } from "@/db";
import { onlineJoins, branches, members } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { requireOwner } from "@/lib/auth-check";
import { getBranchScope } from "@/lib/branch";
import { deriveJoinReference, formatDayIST } from "@/lib/manual-join";
import {
  daysUntilProofSweep,
  sweepExpiredJoinProofs,
} from "@/lib/join-proof-retention";
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

  // Reclaim expired screenshots before reading, so a row swept on this load
  // renders as cleared in this same response rather than showing a thumbnail
  // that 404s. Awaited rather than fired and forgotten: unawaited work gets
  // killed when a serverless invocation returns.
  await sweepExpiredJoinProofs();

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
      // Deliberately NOT selecting proofImage — it's ~80KB of base64 per row and
      // would land in this page's HTML for every request. Only whether one exists
      // is needed here; the image itself is fetched per-card from
      // /api/admin/join-proof/[id] when the owner looks at it.
      proofMime: onlineJoins.proofMime,
      proofUploadedAt: onlineJoins.proofUploadedAt,
      // These two decide what the owner is looking at, and they're the only way
      // to tell the cases apart — `status` alone can't, because one status now
      // covers two very different situations:
      //   pending + no order   they never reached the gateway (payments off, or
      //                        checkout wouldn't load). A lead to call.
      //   pending + order      an order was created and they walked away. Also a
      //                        lead, but they were mid-payment, so worth asking
      //                        whether the money left their account.
      //   paid + payment id    Razorpay captured it. Already activated by the
      //                        webhook or the browser callback — nothing to do.
      //   paid + no payment id the owner took cash/UPI at the counter and
      //                        pressed Confirm himself.
      razorpayOrderId: onlineJoins.razorpayOrderId,
      razorpayPaymentId: onlineJoins.razorpayPaymentId,
      claimedAt: onlineJoins.claimedAt,
      confirmedAt: onlineJoins.confirmedAt,
      rejectedAt: onlineJoins.rejectedAt,
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
    // proofMime alone, NOT proofUploadedAt: the two part company once a
    // screenshot is cleared, because the upload timestamp is kept as the audit
    // trail. Including it here would keep rendering a thumbnail for an image
    // that no longer exists, which resolves to a broken 404.
    hasProof: Boolean(r.proofMime),
    proofUploadedLabel: istDateTime(r.proofUploadedAt),
    // Whether the gateway got as far as an order, and whether it actually took
    // the money. See the comment on the select above for what each combination
    // means for the owner.
    hadOrder: Boolean(r.razorpayOrderId),
    paidOnline: Boolean(r.razorpayPaymentId),
    proofExpiresInDays: daysUntilProofSweep({
      status: r.status,
      hasImage: Boolean(r.proofMime),
      rejectedAt: r.rejectedAt,
      proofUploadedAt: r.proofUploadedAt,
    }),
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
        {/* This page used to be "check the screenshot, then confirm". It isn't any
            more: online payments activate the membership on their own and land
            here already done. What needs a human is the other pile — people who
            filled the form and did NOT pay online. Those are phone calls, so the
            subheading says so. */}
        <p className="adm-sub">
          <strong>{scopeLabel}</strong> · people who filled the form but
          haven&apos;t paid — call them, then confirm once you have the money
        </p>
      </div>
      <JoinRequestsClient initialRequests={requests} />
    </>
  );
}
