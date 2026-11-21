export const HISTORY_RETENTION_DAYS = 31;
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_PERIODS = ["today", "week", "month", "all"] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export type ActivityChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export const ACTIVITY_LABELS: Record<string, string> = {
  "member.created": "Member added",
  "member.updated": "Member details updated",
  "member.deleted": "Member deleted",
  "member.renewed": "Membership renewed",
  "member.marked_left": "Member marked as left",
  "member.restored": "Member restored",
  "member.imported": "Members imported",
  "payment.online.success": "Online payment received",
  "payment.voided": "Payment removed",
  "payment.restored": "Payment restored",
  "payment.updated": "Payment received date corrected",
  "equipment.added": "Equipment expense added",
  "equipment.updated": "Equipment expense updated",
  "equipment.deleted": "Equipment expense deleted",
  "staff.created": "Staff member added",
  "staff.updated": "Staff details updated",
  "staff.deleted": "Staff member deleted",
  "user.created": "Login account added",
  "user.updated": "Login account updated",
  "user.deleted": "Login account deleted",
  "permissions.updated": "Staff permissions updated",
  "trainer.created": "Trainer added",
  "trainer.updated": "Trainer updated",
  "trainer.deleted": "Trainer deleted",
  "plan.updated": "Membership plan updated",
  "plan.toggled": "Membership plan availability changed",
  "branch.updated": "Branch details updated",
  "review.created": "Review added",
  "review.updated": "Review updated",
  "review.deleted": "Review deleted",
  "enquiry.created": "Enquiry added",
  "enquiry.updated": "Enquiry updated",
  "enquiry.deleted": "Enquiry deleted",
  "enquiry.contacted": "Enquiry follow-up recorded",
  "enquiry.imported": "Enquiries imported",
  "join.rejected": "Join request rejected",
  "join.proof_deleted": "Payment screenshot cleared",
};

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Calendar filters use the gym's timezone even when the server runs in UTC. */
export function getHistoryRange(period: HistoryPeriod, now = new Date()) {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let start = midnight;
  if (period === "week") start -= ((local.getUTCDay() + 6) % 7) * DAY_MS;
  if (period === "month") start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * DAY_MS);
  return {
    start: period === "all" ? cutoff : new Date(Math.max(start - IST_OFFSET_MS, cutoff.getTime())),
    end: now,
  };
}

const FIELD_LABELS: Record<string, string> = {
  gymId: "Gym ID", name: "Name", email: "Email", contactNumber: "Phone",
  address: "Address", parentName: "Parent / Father name", emergencyContact: "Emergency contact",
  feeAmount: "Fee", joiningDate: "Joining date", membershipExpiry: "Membership expiry",
  gender: "Gender", planType: "Plan", leftGym: "Left gym", leftGymDate: "Left gym date",
  leftGymReason: "Reason for leaving", leftGymNote: "Leaving note",
  equipmentName: "Equipment", cost: "Cost", date: "Expense date",
};

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "feeAmount" || field === "cost") return `₹${Number(value).toLocaleString("en-IN")}`;
  return String(value).slice(0, 500);
}

/** Only explicitly named business fields are stored; no passwords or image data. */
export function activityChanges(before: Record<string, unknown>, after: Record<string, unknown>): ActivityChange[] {
  return Object.entries(FIELD_LABELS).flatMap(([field, label]) => {
    if (!(field in after) || after[field] === undefined || before[field] === after[field]) return [];
    return [{ field, label, before: displayValue(field, before[field]), after: displayValue(field, after[field]) }];
  });
}
