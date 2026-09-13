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

/** One module's flags, as they are stored: booleans plus the hiddenFields list. */
type PermissionFlags = Record<string, boolean | string[]>;

/**
 * Rebuild a permissions blob using ONLY the keys declared above.
 *
 * WHY THIS EXISTS
 * `permissions` is a jsonb column, and `updatePermissionsAction` is a server
 * action — so its argument is whatever the caller puts on the wire, no matter
 * what the TypeScript signature says. The type annotation is erased at compile
 * time and enforces nothing at runtime. The old code took the blob as given
 * (`permissions as any`) and wrote it straight to the column.
 *
 * Owner-only, so this is not a privilege-escalation hole — a staff account
 * cannot reach it, and `assertCanAdministerUser` stops a branch owner from
 * touching the other gym's logins. The damage is corruption rather than
 * escalation, and one shape in particular matters: `hiddenFields` is read by
 * `getHiddenFields()` and used with `.includes()` to blank member columns at the
 * server boundary. Send it as a string instead of an array and `.includes()`
 * silently becomes a substring test — `"emergencyContact".includes("email")` is
 * false, `"feeAmount,email".includes("email")` is true — so which fields get
 * hidden stops matching what was configured. Unknown module keys and unbounded
 * junk would also just accumulate in the column forever, since nothing reads
 * them and nothing prunes them.
 *
 * Rules: module keys must appear in PERMISSION_MODULES; each flag must be one of
 * that module's declared actions AND a real boolean; `hiddenFields` must be an
 * array and is filtered down to that module's `hideableFields`, deduplicated. A
 * module that contributes nothing valid is omitted, which every reader already
 * treats as "no permission" — the restrictive direction.
 */
export function sanitizeStaffPermissions(input: unknown): StaffPermissions {
  const out: Record<string, PermissionFlags> = {};

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return out as unknown as StaffPermissions;
  }
  const raw = input as Record<string, unknown>;

  for (const mod of PERMISSION_MODULES) {
    const value = raw[mod.key];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const src = value as Record<string, unknown>;
    const flags: PermissionFlags = {};

    for (const action of mod.actions) {
      if (typeof src[action.key] === "boolean") {
        flags[action.key] = src[action.key] as boolean;
      }
    }

    if (mod.hideableFields && Array.isArray(src.hiddenFields)) {
      const allowed = new Set(mod.hideableFields.map((f) => f.key));
      flags.hiddenFields = [
        ...new Set(
          (src.hiddenFields as unknown[]).filter(
            (f): f is string => typeof f === "string" && allowed.has(f)
          )
        ),
      ];
    }

    if (Object.keys(flags).length > 0) out[mod.key] = flags;
  }

  // Safe precisely because every key above came from PERMISSION_MODULES, which
  // is derived from StaffPermissions in the first place. The cast is the one
  // place the whitelist is trusted, rather than the input.
  return out as unknown as StaffPermissions;
}