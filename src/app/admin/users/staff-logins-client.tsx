"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Edit, Trash2, Shield, KeyRound } from "lucide-react";
import PermissionsModal from "./permissions-modal";
import type { StaffPermissions } from "@/db/schema";
import {
  createStaffUserAction,
  updateStaffUserAction,
  deleteStaffUserAction,
} from "@/app/actions/auth";
import { Sheet } from "../sheet";

/** One row as `admin/users/page.tsx` selects it. Exported so that page can
 *  annotate its query instead of casting the prop to `any`. Note what is NOT
 *  here: `passwordHash`. The page's column list already excludes it, and this
 *  type is the second place that has to stay true. */
export type User = {
  id: number;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  email: string;
  role: "owner" | "staff";
  isActive: boolean;
  permissions?: StaffPermissions | null;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialUsers: User[];
  branches: Branch[];
  /**
   * Super-admin only. Controls whether the Role select is offered at all: a
   * branch-scoped owner may add staff to their own gym but never another owner
   * login, since an owner with no branch is a super-admin.
   */
  canManageOwners: boolean;
  /**
   * Set for a branch-scoped owner — the one branch every login they create goes
   * into. The branch picker is replaced by a static line, because the server
   * forces this value regardless of what the form posts.
   */
  lockedBranchName: string | null;
};

export default function StaffLoginsClient({
  initialUsers,
  branches,
  canManageOwners,
  lockedBranchName,
}: Props) {
  const [permissionsUser, setPermissionsUser] = useState<
    (User & { permissions?: StaffPermissions | null }) | null
  >(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const router = useRouter();

  async function handleAdd(fd: FormData) {
    setLoading(true);
    const r = await createStaffUserAction(fd);
    setLoading(false);
    if ("error" in r) toast.error(r.error);
    else {
      toast.success("Staff login created!");
      setShowAdd(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, fd: FormData) {
    setLoading(true);
    const r = await updateStaffUserAction(id, fd);
    setLoading(false);
    if ("error" in r) toast.error(r.error);
    else {
      toast.success("Updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this login account? This cannot be undone.")) return;
    setDeletingId(id);
    const r = await deleteStaffUserAction(id);
    setDeletingId(null);
    if ("error" in r) toast.error(r.error);
    else {
      toast.success("Deleted!");
      router.refresh();
    }
  }

  return (
    <div className="adm-pagebody">
      {/* Desktop's stand-in for the FAB — above the list so it is not a scroll
          away. display:none on a phone, where the FAB does this job. */}
      <button
        type="button"
        className="adm-btn primary adm-desk-only"
        onClick={() => setShowAdd(true)}
      >
        <Plus size={16} /> Add Staff Login
      </button>

      {initialUsers.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <KeyRound size={22} />
          </div>
          <p className="adm-empty-title">No logins yet</p>
          <p className="adm-empty-text">
            Add one with the + button. Staff must be assigned a branch.
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {initialUsers.map((u) => (
          <article
            key={u.id}
            className="adm-rec"
            style={u.isActive ? undefined : { opacity: 0.62 }}
          >
            <div className="adm-rec-top">
              <div className="adm-rec-ava">{u.name.charAt(0)}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="adm-rec-name">{u.name}</div>
                <div className="adm-rec-tags">
                  <span className={`adm-tag ${u.role === "owner" ? "gold" : "info"}`}>
                    {u.role}
                  </span>
                  {u.branchCode ? (
                    <span className="adm-tag purple">{u.branchCode}</span>
                  ) : u.role === "owner" ? (
                    <span className="adm-tag muted">All branches</span>
                  ) : (
                    // A staff row with no branch can log in but sees nothing,
                    // so it is flagged rather than left to look normal.
                    <span className="adm-tag off">No branch</span>
                  )}
                  {!u.isActive && <span className="adm-tag muted">Inactive</span>}
                </div>
              </div>
            </div>

            <div className="adm-rec-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="adm-rec-k">Email</div>
                <div className="adm-rec-v">{u.email}</div>
              </div>
            </div>

            <div className="adm-rec-foot">
              {u.role === "staff" && (
                <button
                  type="button"
                  onClick={() => setPermissionsUser(u)}
                  className="adm-act"
                  style={{ color: "var(--blue2)" }}
                  aria-label={`Edit permissions for ${u.name}`}
                >
                  <Shield size={15} />
                  <span className="adm-act-label">Access</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(u)}
                className="adm-act gold"
                aria-label={`Edit ${u.name}`}
              >
                <Edit size={15} />
                <span className="adm-act-label">Edit</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(u.id)}
                disabled={deletingId === u.id}
                className="adm-act icon red"
                aria-label={`Delete ${u.name}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        </div>
      )}

      <button
        type="button"
        className="adm-fab"
        onClick={() => setShowAdd(true)}
        aria-label="Add staff login"
      >
        <Plus size={18} /> Login
      </button>
      {showAdd && (
        <Sheet onClose={() => setShowAdd(false)} title="Add Staff Login">
          <form action={handleAdd}>
            <div className="adm-field">
              <label className="adm-label" htmlFor="us-name">
                Full Name *
              </label>
              <input id="us-name" name="name" required className="adm-input" />
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="us-email">
                Email *
              </label>
              <input
                id="us-email"
                name="email"
                type="email"
                required
                className="adm-input"
              />
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="us-pass">
                Password *
              </label>
              <input
                id="us-pass"
                name="password"
                type="password"
                required
                minLength={6}
                className="adm-input"
              />
              <p className="adm-hint">At least 6 characters.</p>
            </div>

            {lockedBranchName ? (
              <div className="adm-field">
                <div className="adm-rec-k">Branch</div>
                <div className="adm-rec-v">{lockedBranchName}</div>
                <p className="adm-hint">
                  Staff logins you add belong to your gym and can only see your
                  gym&apos;s data.
                </p>
              </div>
            ) : (
              <div className="adm-form-grid">
                {canManageOwners && (
                  <div className="adm-field">
                    <label className="adm-label" htmlFor="us-role">
                      Role *
                    </label>
                    <select
                      id="us-role"
                      name="role"
                      defaultValue="staff"
                      required
                      className="adm-select"
                    >
                      <option value="staff">Staff (single branch)</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                )}

                <div className="adm-field">
                  <label className="adm-label" htmlFor="us-branch">
                    Assigned Branch
                  </label>
                  <select id="us-branch" name="branchId" className="adm-select">
                    <option value="">-- No branch (all branches) --</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                  <p className="adm-hint">
                    Staff must have a branch. An <strong>owner with a branch</strong>{" "}
                    sees only that gym; an <strong>owner with no branch</strong> sees
                    and manages both.
                  </p>
                </div>
              </div>
            )}
            {/* Only the main owner account may choose a role, so for everyone
                else it is pinned to staff here rather than left to the server to
                silently correct. */}
            {!canManageOwners && <input type="hidden" name="role" value="staff" />}

            <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="adm-btn"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="adm-btn primary"
                style={{ flex: 2 }}
              >
                {loading ? "Creating…" : "Create Login"}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)} title={`Edit ${editing.name}`}>
          <form action={(fd) => handleUpdate(editing.id, fd)}>
            <div className="adm-field">
              <label className="adm-label" htmlFor="ue-name">
                Full Name *
              </label>
              <input
                id="ue-name"
                name="name"
                required
                defaultValue={editing.name}
                className="adm-input"
              />
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="ue-email">
                Email *
              </label>
              <input
                id="ue-email"
                name="email"
                type="email"
                required
                defaultValue={editing.email}
                className="adm-input"
              />
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="ue-pass">
                New Password
              </label>
              <input
                id="ue-pass"
                name="password"
                type="password"
                minLength={6}
                placeholder="At least 6 characters"
                className="adm-input"
              />
              <p className="adm-hint">Leave empty to keep the current password.</p>
            </div>

            {lockedBranchName ? (
              <div className="adm-field">
                <div className="adm-rec-k">Branch</div>
                <div className="adm-rec-v">{lockedBranchName}</div>
              </div>
            ) : (
              <div className="adm-field">
                <label className="adm-label" htmlFor="ue-branch">
                  Assigned Branch
                </label>
                <select
                  id="ue-branch"
                  name="branchId"
                  defaultValue={editing.branchId || ""}
                  className="adm-select"
                >
                  <option value="">-- No branch (all branches) --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
                {editing.role === "owner" && (
                  <p className="adm-hint">
                    This is the switch for dashboard separation. A branch here
                    limits this owner to that gym; clearing it gives them both
                    gyms back immediately — no other change needed.
                  </p>
                )}
              </div>
            )}

            <label className="adm-switch">
              <span className="adm-switch-text">
                <span className="adm-switch-title">Account active</span>
                <span className="adm-switch-sub">
                  Off blocks login without deleting the account
                </span>
              </span>
              <input
                type="checkbox"
                name="isActive"
                value="true"
                defaultChecked={editing.isActive}
              />
              <span className="adm-switch-track" aria-hidden="true" />
            </label>

            <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="adm-btn"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="adm-btn primary"
                style={{ flex: 2 }}
              >
                {loading ? "Updating…" : "Update Login"}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {permissionsUser && (
        <PermissionsModal
          userId={permissionsUser.id}
          userName={permissionsUser.name}
          initialPermissions={permissionsUser.permissions || null}
          onClose={() => setPermissionsUser(null)}
        />
      )}
    </div>
  );
}
