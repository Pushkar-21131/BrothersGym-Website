"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Check, Lock } from "lucide-react";
import { updatePermissionsAction } from "@/app/actions/permissions";
import { PERMISSION_MODULES, DEFAULT_STAFF_PERMISSIONS } from "@/lib/permissions";
import type { StaffPermissions } from "@/db/schema";
import { Sheet } from "../sheet";

type Props = {
  userId: number;
  userName: string;
  initialPermissions: StaffPermissions | null;
  onClose: () => void;
};

export default function PermissionsModal({
  userId,
  userName,
  initialPermissions,
  onClose,
}: Props) {
  const [perms, setPerms] = useState<StaffPermissions>(
    initialPermissions || DEFAULT_STAFF_PERMISSIONS
  );
  const [loading, setLoading] = useState(false);

  function toggleAction(moduleKey: string, actionKey: string) {
    setPerms((prev) => {
      const modulePerms = (prev[moduleKey as keyof StaffPermissions] as any) || {};
      const next = { ...modulePerms, [actionKey]: !modulePerms[actionKey] };
      const mod = PERMISSION_MODULES.find((m) => m.key === moduleKey);

      // Mirrors the server, so the panel never shows a state the save changes.
      //
      // In an add-only module View is a mode rather than a gate — it means
      // "sees every row" — so toggling it clears nothing. View off + Add on is
      // the notepad, View off + Edit on is "edit my own", and turning Add off
      // is how access is removed. Everywhere else View IS the gate, so an
      // action that cannot be reached is not a permission.
      if (mod?.allowAddOnly !== true) {
        if (actionKey !== "canView" && next[actionKey]) next.canView = true;
        if (actionKey === "canView" && !next.canView) {
          for (const a of mod?.actions ?? []) {
            if (a.key !== "canView") next[a.key] = false;
          }
        }
      }

      return { ...prev, [moduleKey]: next };
    });
  }

  function toggleHiddenField(moduleKey: string, fieldKey: string) {
    setPerms((prev) => {
      const modulePerms = (prev[moduleKey as keyof StaffPermissions] as any) || {};
      const currentHidden: string[] = modulePerms.hiddenFields || [];
      const newHidden = currentHidden.includes(fieldKey)
        ? currentHidden.filter((f) => f !== fieldKey)
        : [...currentHidden, fieldKey];

      return {
        ...prev,
        [moduleKey]: {
          ...modulePerms,
          hiddenFields: newHidden,
        },
      };
    });
  }

  function applyPreset(preset: "receptionist" | "trainer" | "manager" | "readonly") {
    if (preset === "receptionist") {
      setPerms({
        dashboard: { canView: false },
        members: {
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: false,
          hiddenFields: [],
        },
        reminders: { canView: true, canSendWhatsApp: true, canSendSMS: true },
        equipment: { canView: true, canAdd: false, canEdit: false, canDelete: false },
        import: { canView: true, canUse: true },
        security: { canView: false },
        trainers: { canView: false, canEdit: false },
        staff: { canView: false, canEdit: false },
        reviews: { canView: false, canEdit: false },
      });
      toast.success("Receptionist preset applied");
    } else if (preset === "trainer") {
      setPerms({
        dashboard: { canView: false },
        members: {
          canView: true,
          canAdd: false,
          canEdit: false,
          canDelete: false,
          hiddenFields: ["feeAmount", "email", "address"],
        },
        reminders: { canView: false, canSendWhatsApp: false, canSendSMS: false },
        equipment: { canView: true, canAdd: false, canEdit: false, canDelete: false },
        import: { canView: false, canUse: false },
        security: { canView: false },
        trainers: { canView: false, canEdit: false },
        staff: { canView: false, canEdit: false },
        reviews: { canView: false, canEdit: false },
      });
      toast.success("Trainer preset applied");
    } else if (preset === "manager") {
      setPerms({
        dashboard: { canView: true },
        members: {
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          hiddenFields: [],
        },
        reminders: { canView: true, canSendWhatsApp: true, canSendSMS: true },
        equipment: { canView: true, canAdd: true, canEdit: true, canDelete: true },
        import: { canView: true, canUse: true },
        security: { canView: true },
        trainers: { canView: true, canEdit: true },
        staff: { canView: true, canEdit: true },
        reviews: { canView: true, canEdit: true },
      });
      toast.success("Manager preset applied");
    } else if (preset === "readonly") {
      setPerms({
        dashboard: { canView: true },
        members: {
          canView: true,
          canAdd: false,
          canEdit: false,
          canDelete: false,
          hiddenFields: ["feeAmount", "email", "address"],
        },
        reminders: { canView: true, canSendWhatsApp: false, canSendSMS: false },
        equipment: { canView: true, canAdd: false, canEdit: false, canDelete: false },
        import: { canView: false, canUse: false },
        security: { canView: false },
        trainers: { canView: true, canEdit: false },
        staff: { canView: true, canEdit: false },
        reviews: { canView: true, canEdit: false },
      });
      toast.success("Read-only preset applied");
    }
  }

  async function handleSave() {
    setLoading(true);
    const r = await updatePermissionsAction(userId, perms);
    setLoading(false);
    if ("error" in r) toast.error(r.error);
    else {
      toast.success(`Permissions saved for ${userName}`);
      onClose();
    }
  }

  return (
    <Sheet onClose={onClose} title={`Access · ${userName}`}>
      {/* Presets first: setting nine modules by hand on a phone is a chore, and
          a preset gets it 90% right before any tapping starts. */}
      <h3 className="adm-h2" style={{ marginTop: 0 }}>
        Quick Presets
      </h3>
      <div className="adm-chips" style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => applyPreset("receptionist")}
          className="adm-chip"
        >
          Receptionist
        </button>
        <button type="button" onClick={() => applyPreset("trainer")} className="adm-chip">
          Trainer
        </button>
        <button type="button" onClick={() => applyPreset("manager")} className="adm-chip">
          Manager
        </button>
        <button
          type="button"
          onClick={() => applyPreset("readonly")}
          className="adm-chip"
        >
          Read Only
        </button>
      </div>

      <h3 className="adm-h2">Modules</h3>

      {PERMISSION_MODULES.map((mod) => {
        const modulePerms = (perms[mod.key] as any) || {};
        const hiddenFields: string[] = modulePerms.hiddenFields || [];
        const hasAnyAction = mod.actions.some((a) => modulePerms[a.key]);

        // View is the disclosure control, because it is the gate: nothing in a
        // module is reachable without it, so a section that is off is one switch
        // and not a wall of them. Keyed off hasAnyAction rather than canView so a
        // record stored before View was implied still shows what it grants.
        const open = hasAnyAction;
        const viewAction = mod.actions.find((a) => a.key === "canView");
        const subActions = mod.actions.filter((a) => a.key !== "canView");

        const renderSwitch = (action: { key: string; label: string }) => (
          <label key={action.key} className="adm-switch">
            <span className="adm-switch-text">
              <span className="adm-switch-title">{action.label}</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(modulePerms[action.key])}
              onChange={() => toggleAction(mod.key, action.key)}
            />
            <span className="adm-switch-track" aria-hidden="true" />
          </label>
        );

        return (
          <div key={mod.key} className={`adm-perm${hasAnyAction ? " on" : ""}`}>
            <div className="adm-perm-title">{mod.label}</div>
            <div className="adm-perm-desc">{mod.description}</div>

            <div className="adm-perm-acts">
              {viewAction && renderSwitch(viewAction)}
              {open && subActions.length > 0 && (
                <div className="adm-perm-kids">{subActions.map(renderSwitch)}</div>
              )}
            </div>

            {/* The state the owner reached for and could not get: writing
                without reading. Without this line it is indistinguishable from
                the broken config that showed nothing at all. */}
            {mod.allowAddOnly && !modulePerms.canView && hasAnyAction && (
              <p className="adm-hint" style={{ marginTop: 9 }}>
                Sees only the entries they add — not the rest of the list.
              </p>
            )}

            {/* Field hiding only matters once the module is visible at all. */}
            {mod.hideableFields && open && (
              <div className="adm-perm-hide">
                <p className="adm-hint" style={{ marginBottom: 8 }}>
                  Tap a field to hide it from this staff member.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {mod.hideableFields.map((field) => {
                    const isHidden = hiddenFields.includes(field.key);
                    return (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => toggleHiddenField(mod.key, field.key)}
                        className={`adm-perm-field${isHidden ? " hidden" : ""}`}
                        aria-pressed={isHidden}
                      >
                        {isHidden && <Lock size={11} />}
                        {field.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onClose} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          <Check size={16} />
          {loading ? "Saving…" : "Save Access"}
        </button>
      </div>
    </Sheet>
  );
}
