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
  })
);

// ========== PAYMENTS ==========
export const payments = pgTable("payments", {
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
});

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
  photoUrl: text("photo_url"),
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
export const onlineJoins = pgTable("online_joins", {
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
  // Manual UPI flow: the member's optional UTR / reference number, when the
  // owner confirmed the payment, and when the member tapped "I've paid".
  upiReference: text("upi_reference"),
  claimedAt: timestamp("claimed_at"),
  confirmedAt: timestamp("confirmed_at"),
  memberId: integer("member_id").references(() => members.id),
  createdAt: timestamp("created_at").defaultNow(),
});

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
export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

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
