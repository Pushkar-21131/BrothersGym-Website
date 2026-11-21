/**
 * Sensitive action types that should be audited.
 * Add new events here as needed.
 */
export type AuditEvent =
  // Member events
  | "member.created"
  | "member.updated"
  | "member.deleted"
  | "member.renewed"
  | "member.marked_left"
  | "member.restored"
  | "member.imported"
  // Payment events
  | "payment.online.success"
  | "payment.online.failed"
  | "payment.recorded_offline"
  | "payment.refund_requested"
  // A payment row is never deleted, so these two are the whole story of an
  // entry leaving a member's timeline and coming back.
  | "payment.voided"
  | "payment.restored"
  | "payment.updated"
  // Staff/user events
  | "staff.created"
  | "staff.updated"
  | "staff.deleted"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "permissions.updated"
  // Plan events
  | "plan.updated"
  | "plan.toggled"
  // Branch events
  | "branch.switched"
  | "branch.updated"
  // Security events
  | "password.reset_requested"
  | "password.reset_completed"
  | "password.changed"
  | "login.suspicious"
  // Data events
  | "data.exported"
  | "data.imported"
  // Trainer/Review events
  | "trainer.created"
  | "trainer.updated"
  | "trainer.deleted"
  | "review.created"
  | "review.updated"
  | "review.deleted"
  // Equipment events
  | "equipment.added"
  | "equipment.updated"
  | "equipment.deleted"
  | "enquiry.created"
  | "enquiry.updated"
  | "enquiry.deleted"
  | "enquiry.contacted"
  | "enquiry.imported"
  | "join.rejected"
  | "join.proof_deleted"
  // System events
  | "settings.updated"
  | "sms.sent";
