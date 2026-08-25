/**
 * Permission definitions — single source of truth.
 * Change this file to add/remove modules or actions.
 */

import type { StaffPermissions } from "@/db/schema";

export type ModuleKey = keyof NonNullable<StaffPermissions>;

export type PermissionModule = {
  key: ModuleKey;
  label: string;
  description: string;
  actions: { key: string; label: string }[];
  hideableFields?: { key: string; label: string }[];
};

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "View revenue, profit, and financial stats",
    actions: [{ key: "canView", label: "Can view dashboard" }],
  },
  {
    key: "members",
    label: "Members",
    description: "Manage gym members and their memberships",
    actions: [
      { key: "canView", label: "View members" },
      { key: "canAdd", label: "Add new members" },
      { key: "canEdit", label: "Edit members" },
      { key: "canDelete", label: "Delete members" },
    ],
    hideableFields: [
      { key: "feeAmount", label: "Fee Amount (₹)" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "parentName", label: "Parent Name" },
      { key: "emergencyContact", label: "Emergency Contact" },
    ],
  },
  {
    key: "reminders",
    label: "Message Reminders",
    description: "Send renewal reminders to members",
    actions: [
      { key: "canView", label: "View reminders page" },
      { key: "canSendWhatsApp", label: "Send WhatsApp reminders" },
      { key: "canSendSMS", label: "Send SMS reminders (paid)" },
    ],
  },
  {
    key: "equipment",
    label: "Equipment",
    description: "Track gym equipment and expenses",
    actions: [
      { key: "canView", label: "View equipment" },
      { key: "canAdd", label: "Add equipment entries" },
      { key: "canEdit", label: "Edit equipment" },
      { key: "canDelete", label: "Delete equipment" },
    ],
  },
  {
    key: "import",
    label: "Import Members",
    description: "Bulk import members from Excel",
    actions: [
      { key: "canView", label: "Access import page" },
      { key: "canUse", label: "Upload & import files" },
    ],
  },
  {
    key: "security",
    label: "Security",
    description: "View login attempts and security logs",
    actions: [{ key: "canView", label: "View security logs" }],
  },
  {
    key: "trainers",
    label: "Trainers",
    description: "Manage trainer profiles",
    actions: [
      { key: "canView", label: "View trainers" },
      { key: "canEdit", label: "Edit trainers" },
    ],
  },
  {
    key: "staff",
    label: "Staff Management",
    description: "Manage staff records (not logins)",
    actions: [
      { key: "canView", label: "View staff" },
      { key: "canEdit", label: "Edit staff" },
    ],
  },
  {
    key: "reviews",
    label: "Reviews",
    description: "Manage member reviews shown on public site",
    actions: [
      { key: "canView", label: "View reviews" },
      { key: "canEdit", label: "Add/edit/delete reviews" },
    ],
  },
];

/**
 * Default permissions when a new staff is created.
 * Restrictive by default — owner opens things up as needed.
 */
export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  members: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    hiddenFields: ["feeAmount"],
  },
  reminders: {
    canView: true,
    canSendWhatsApp: true,
    canSendSMS: false,
  },
  equipment: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
  },
  import: { canView: false, canUse: false },
  security: { canView: false },
  trainers: { canView: false, canEdit: false },
  staff: { canView: false, canEdit: false },
  reviews: { canView: false, canEdit: false },
  dashboard: { canView: false },
};