import {
  pgTable,
  serial,
  text,
  integer,
  date,
  boolean,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ========== BRANCHES (NEW) ==========
export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // "NR" | "SP"
  name: text("name").notNull(),          // "Nangal Raya" | "Sagar Pur"
  address: text("address").notNull(),
  phone: text("phone"),
  ownerName: text("owner_name"),        // ✅ NEW
  ownerEmail: text("owner_email"),      // ✅ NEW
  mapUrl: text("map_url"),  // ✅ ADD THIS LINE
  // Manual UPI payments: the branch's payee VPA and the verified name the UPI
  // app shows the payer before they confirm. Nullable — a branch with no upiId
  // set simply can't accept online payments and the join screen says so.
  upiId: text("upi_id"),
  upiName: text("upi_name"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== MEMBERS ==========
export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .references(() => branches.id)
      .notNull(),
    gymId: integer("gym_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    contactNumber: text("contact_number").notNull(),
    address: text("address"),
    parentName: text("parent_name"),
    emergencyContact: text("emergency_contact").notNull(),
    feeAmount: integer("fee_amount").notNull(),
    joiningDate: date("joining_date").notNull().defaultNow(),
    membershipExpiry: date("membership_expiry").notNull(),
    planType: text("plan_type")
      .$type<"full" | "no_cardio" | "offline">()
      .default("offline"),
    
    // After existing fields, add:
    consentToHealthData: boolean("consent_to_health_data").default(false),
    consentDate: timestamp("consent_date"),
    consentIpAddress: text("consent_ip_address"),

    // Inactive / left gym tracking (Phase 5)
    leftGym: boolean("left_gym").default(false).notNull(),
    leftGymDate: date("left_gym_date"),
    leftGymReason: text("left_gym_reason").$type<
      "shifted" | "not_interested" | "health" | "financial" | "other" | null
    >(),
    leftGymNote: text("left_gym_note"),
    wonBackAt: timestamp("won_back_at"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // Same gymId can exist in different branches
    branchGymIdUnique: unique("members_branch_gymid_unique").on(
      table.branchId,
      table.gymId
    ),
    // The expiry scans: the dashboard counts expired and expiring-in-7-days per
    // branch on every load, and the reminder page reads the same range.
    //
    // Deliberately NOT a separate index on branchId alone — the composite
    // unique above already covers `WHERE branch_id = ?` by leftmost prefix, so
    // one would be dead weight on every insert.
    membershipExpiryIdx: index("members_membership_expiry_idx").on(
      table.membershipExpiry
    ),
  })
);

// ========== PAYMENTS ==========
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .references(() => branches.id)
      .notNull(),
    memberId: integer("member_id").references(() => members.id),
    amount: integer("amount").notNull(),
    date: date("date").notNull(),
    method: text("method")
      .$type<"cash" | "upi" | "razorpay" | "other">()
      .default("cash"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // A member's payment history, read whenever the owner opens one member.
    memberIdx: index("payments_member_id_idx").on(table.memberId),
    // The revenue sum on the dashboard, per branch, on every load. This one is
    // a genuine full-table scan without an index: it touches every payment row
    // the gym has ever taken.
    branchIdx: index("payments_branch_id_idx").on(table.branchId),
  })
);

export const memberRelations = relations(members, ({ many, one }) => ({
  payments: many(payments),
  branch: one(branches, {
    fields: [members.branchId],
    references: [branches.id],
  }),
}));

export const paymentRelations = relations(payments, ({ one }) => ({
  member: one(members, {
    fields: [payments.memberId],
    references: [members.id],
  }),
  branch: one(branches, {
    fields: [payments.branchId],
    references: [branches.id],
  }),
}));

// ========== TRAINERS ==========
export const trainers = pgTable("trainers", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id")
    .references(() => branches.id)
    .notNull(),
  name: text("name").notNull(),
  // An externally hosted photo, e.g. a Cloudinary or Google Drive link.
  //
  // Kept alongside the uploaded photo below rather than replaced by it, for two
  // reasons: the rows already in this table use it, and a link costs no database
  // space, so an owner who does have proper image hosting should still be able to
  // point at it. photoImage wins when both are set — see resolveTrainerPhoto.
  //
  // The catch, and why uploading is now the primary path: nothing here can keep a
  // third-party URL alive. Every one of the original four trainer photos was a
  // link into a free "cloudinary tools" uploader, and all four returned 404 once
  // that service dropped them, leaving the homepage showing broken images with no
  // copy of the originals anywhere.
  photoUrl: text("photo_url"),
  // A photo uploaded through the admin panel, base64, served by
  // /api/trainer-photo/[id]. Same storage tradeoff as the payment proof in
  // online_joins: no object store on a free tier, so the bytes live in Postgres.
  //
  // Cheaper here than it looks. Trainers are a handful of rows that change once a
  // year, the admin client downscales to 800px before upload (~40–80KB, capped at
  // 200KB by lib/trainer-photo.ts), so a four-trainer gym spends well under 0.5MB
  // — unlike join proofs, which arrive with every new member and needed a
  // retention sweep to stay bounded.
  //
  // NOT selected by the public trainer queries: that would put base64 into the
  // homepage HTML for every trainer. Those read photoMime instead, which is only
  // ever set together with this column, and let the browser fetch the bytes.
  photoImage: text("photo_image"),
  // Sniffed from the uploaded bytes, never taken from the browser. Doubles as the
  // "is there an uploaded photo?" flag, so a query can answer that without
  // selecting the image itself.
  photoMime: text("photo_mime"),
  experience: text("experience").notNull(),
  ptFee: integer("pt_fee").notNull(),
  isOwner: boolean("is_owner").default(false).notNull(),
  instagramUrl: text("instagram_url"), // Optional
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== STAFF ==========
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id")
    .references(() => branches.id)
    .notNull(),
  name: text("name").notNull(),
  category: text("category")
    .$type<"Trainer" | "Worker" | "Cleaner">()
    .notNull(),
  salary: integer("salary").notNull(),
  contactNumber: text("contact_number").notNull(),
  address: text("address"),
  joinDate: date("join_date").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== EQUIPMENT ==========
export const equipmentExpenses = pgTable("equipment_expenses", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id")
    .references(() => branches.id)
    .notNull(),
  equipmentName: text("equipment_name").notNull(),
  cost: integer("cost").notNull(),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== APP USERS ==========
// Owner: branchId = NULL (sees all branches)
// Staff: branchId = specific branch (locked to that branch)
export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => branches.id), // NULL for owner
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"owner" | "staff">().notNull(),
  isActive: boolean("is_active").default(true).notNull(),

  // Granular permissions (Phase 4)
  // Structure: { members: { canView, canAdd, canEdit, canDelete, visibleFields[], hiddenFields[] }, ... }
  permissions: jsonb("permissions").$type<StaffPermissions>(),

  createdAt: timestamp("created_at").defaultNow(),
});

// ========== MEMBERSHIP PLANS ==========
// Now per-branch: NR has its plans, SP has its own
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .references(() => branches.id)
      .notNull(),
    name: text("name").notNull(),
    code: text("code")
      .$type<"full_1m" | "full_3m" | "full_6m" | "full_12m" | "no_cardio_1m" | "no_cardio_3m" | "no_cardio_6m" | "no_cardio_12m">()
      .notNull(),
    price: integer("price").notNull(),
    durationDays: integer("duration_days").notNull().default(30),
    description: text("description"),
    includesCardio: boolean("includes_cardio").default(true).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0),
  },
  (table) => ({
    branchCodeUnique: unique("plans_branch_code_unique").on(
      table.branchId,
      table.code
    ),
  })
);

// ========== ONLINE JOIN ORDERS ==========
export const onlineJoins = pgTable(
  "online_joins",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .references(() => branches.id)
      .notNull(),
    name: text("name").notNull(),
    email: text("email"),
    contactNumber: text("contact_number").notNull(),
    address: text("address"),
    planCode: text("plan_code").notNull(), // plan code from membershipPlans
    amount: integer("amount").notNull(),
    // Captured at order creation, where they are already validated. They used to
    // make a round trip through the browser and come back on the verify call,
    // which meant the Razorpay webhook — which never sees the browser — had no way
    // to get them and created memberships with both fields empty. Nullable because
    // rows created before this column existed have neither.
    parentName: text("parent_name"),
    emergencyContact: text("emergency_contact"),
    status: text("status")
      // "pending"  — request created, member is on the pay screen / hasn't paid.
      // "claimed"  — member tapped "I've paid" (manual UPI); awaiting owner confirm.
      // "paid"     — fulfilled: owner confirmed (UPI) or Razorpay captured. Member exists.
      // "rejected" — owner rejected the request.
      // "failed"   — reserved (Razorpay-era); never written by the manual flow.
      .$type<"pending" | "claimed" | "paid" | "rejected" | "failed">()
      .default("pending")
      .notNull(),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    // LEGACY. The join flow briefly asked members to type their UTR / UPI
    // reference by hand. Almost nobody knows what a UTR is, so the field was
    // replaced by the screenshot below — which shows the same number, and the
    // amount and payee besides, without anyone having to find it. Kept, not
    // dropped: rows created while the field existed still carry a real value, and
    // fulfilManualJoin preserves it on confirm. Nothing writes it any more.
    upiReference: text("upi_reference"),
    claimedAt: timestamp("claimed_at"),
    confirmedAt: timestamp("confirmed_at"),
    // When the owner rejected the request. Drives the 10-day retention window on
    // the payment screenshot below — deliberately not proofUploadedAt, because a
    // request the owner leaves sitting for two weeks would otherwise have its
    // evidence swept the same day it was rejected, which is exactly when the
    // member is most likely to argue about it.
    rejectedAt: timestamp("rejected_at"),
    // ===== PAYMENT PROOF (manual UPI flow) =====
    // The screenshot of the member's UPI success screen, base64-encoded, stored in
    // the row rather than an object store: there is no bucket on the free tier and
    // adding a vendor for ~60KB per join is not worth the dependency. Compressed
    // client-side before upload (see compressToJpeg in join-plans-client), so a
    // typical proof is 40–90KB of base64 — a few thousand fit inside a 0.5GB
    // Postgres allowance.
    //
    // It is never sent to the browser inline. /api/admin/join-proof/[id] streams it
    // to the owner on demand, so a 200-row admin page stays a normal-sized page.
    //
    // A screenshot carries the UTR, amount, timestamp and payee visibly, which is
    // why the flow no longer asks the member to type a UTR — nobody knows what one
    // is, and the image already contains it.
    //
    // RETENTION. base64 stores at 4/3 of the image, so a proof occupies ~53–120KB
    // of the 0.5GB Neon allowance — about 6,400 of them, shared with every other
    // table. Nothing reclaims that on its own, so two rules bound it:
    //   • rejected  → swept 10 days after rejectedAt (sweepExpiredJoinProofs,
    //                 called on each admin join-requests load; no cron needed).
    //   • confirmed → kept indefinitely. The owner clears it by hand when they
    //                 want to (deleteJoinProof), after downloading it if they
    //                 want their own copy.
    // Clearing sets proofImage AND proofMime to null but never touches
    // proofUploadedAt: that timestamp is the audit trail that a screenshot was
    // submitted, and it has to outlive the bytes. Which is why "is there an image
    // to show?" is derived from proofMime — deriving it from proofUploadedAt would
    // keep rendering a thumbnail for a row whose image is long gone.
    proofImage: text("proof_image"),
    proofMime: text("proof_mime"),
    proofUploadedAt: timestamp("proof_uploaded_at"),
    memberId: integer("member_id").references(() => members.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // The webhook's only lookup key. It runs on Razorpay's clock with a retry
    // timeout, so this is the one index where a slow scan can cost a confirmed
    // payment rather than just a slow page.
    razorpayOrderIdx: index("online_joins_razorpay_order_id_idx").on(
      table.razorpayOrderId
    ),
    // The admin Join Requests queue: pending / claimed rows for one branch.
    branchStatusIdx: index("online_joins_branch_status_idx").on(
      table.branchId,
      table.status
    ),
  })
);

// ========== REVIEWS ==========
// Reviews are shared across branches (they're for the brand)
// If you want per-branch reviews later, add branchId here
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => branches.id), // NULL = brand-wide
  memberName: text("member_name").notNull(),
  rating: integer("rating").notNull(),
  reviewText: text("review_text").notNull(),
  memberSince: text("member_since"),
  photoUrl: text("photo_url"),
  isVisible: boolean("is_visible").default(true).notNull(),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== LOGIN OTPs ==========
export const loginOtps = pgTable("login_otps", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  otp: text("otp").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  deviceInfo: text("device_info"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== LOGIN ATTEMPTS LOG ==========
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    success: boolean("success").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // This table only grows, and every read of it is "recent attempts first".
    createdAtIdx: index("login_attempts_created_at_idx").on(table.createdAt),
  })
);

// ========== RATE LIMIT ==========
export const rateLimitAttempts = pgTable("rate_limit_attempts", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  attempts: integer("attempts").default(1).notNull(),
  windowStart: timestamp("window_start").defaultNow().notNull(),
  blockedUntil: timestamp("blocked_until"),
});

// ========== SMS LOG ==========
export const smsLogs = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => branches.id),
  memberId: integer("member_id").references(() => members.id),
  phoneNumber: text("phone_number").notNull(),
  message: text("message").notNull(),
  status: text("status").$type<"sent" | "failed">().notNull(),
  cost: integer("cost").default(0),
  sentBy: text("sent_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========== TYPES ==========
export type StaffPermissions = {
  members?: {
    canView?: boolean;
    canAdd?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    hiddenFields?: string[]; // e.g. ["feeAmount", "email", "address"]
  };
  reminders?: {
    canView?: boolean;
    canSendWhatsApp?: boolean;
    canSendSMS?: boolean;
  };
  equipment?: {
    canView?: boolean;
    canAdd?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
  };
  import?: { canView?: boolean; canUse?: boolean };
  security?: { canView?: boolean };
  trainers?: { canView?: boolean; canEdit?: boolean };
  staff?: { canView?: boolean; canEdit?: boolean };
  reviews?: { canView?: boolean; canEdit?: boolean };
  dashboard?: { canView?: boolean };
};
