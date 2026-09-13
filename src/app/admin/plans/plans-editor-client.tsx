"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Edit,
  Building2,
  Clock,
  Dumbbell,
  Power,
  Tag,
} from "lucide-react";
import { updatePlanAction, togglePlanActiveAction } from "@/app/actions/plans";
import { formatINR } from "@/lib/utils";
import { Sheet } from "../sheet";

/** One row as `admin/plans/page.tsx` selects it. Exported so that page can
 *  annotate its query instead of casting the prop to `any`. */
export type Plan = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  code: string;
  price: number;
  durationDays: number;
  description: string | null;
  includesCardio: boolean;
  isActive: boolean;
  // Nullable, matching the column: `integer("display_order").default(0)` has a
  // default but no NOT NULL, so the default only applies when the column is
  // omitted — an explicit null still stores null. This said `number` until the
  // `as any` on the prop came off and tsc disagreed.
  displayOrder: number | null;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialPlans: Plan[];
  allBranches: Branch[];
};

export default function PlansEditorClient({ initialPlans, allBranches }: Props) {
  const [editing, setEditing] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const router = useRouter();

  // Group plans by branch for display
  const plansByBranch = allBranches
    .map((b) => ({
      branch: b,
      plans: initialPlans.filter((p) => p.branchId === b.id),
    }))
    .filter((g) => g.plans.length > 0);

  async function handleUpdate(id: number, fd: FormData) {
    setLoading(true);
    const r = await updatePlanAction(id, fd);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Plan updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleToggle(plan: Plan) {
    setTogglingId(plan.id);
    const r = await togglePlanActiveAction(plan.id, !plan.isActive);
    setTogglingId(null);
    if (r.error) toast.error(r.error);
    else {
      toast.success(`Plan ${!plan.isActive ? "activated" : "deactivated"}`);
      router.refresh();
    }
  }

  if (plansByBranch.length === 0) {
    return (
      <div className="adm-empty">
        <div className="adm-empty-icon">
          <Tag size={22} />
        </div>
        <p className="adm-empty-title">No plans found</p>
        <p className="adm-empty-text">
          Plans are seeded automatically during migration.
        </p>
      </div>
    );
  }

  return (
    <div className="adm-pagebody">
      {plansByBranch.map(({ branch, plans }) => (
        <section key={branch.id} style={{ marginBottom: 22 }}>
          <h2 className="adm-h2">
            <Building2 size={15} /> {branch.name}
            <span className="adm-tag gold" style={{ marginLeft: 6 }}>
              {branch.code}
            </span>
          </h2>

          <div className="adm-list">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className="adm-rec"
              style={plan.isActive ? undefined : { opacity: 0.55 }}
            >
              <div className="adm-rec-top">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-rec-name">{plan.name}</div>
                  <div className="adm-rec-tags">
                    <span
                      className={`adm-tag ${plan.isActive ? "ok" : "muted"}`}
                    >
                      {plan.isActive ? "Live" : "Paused"}
                    </span>
                    <span className="adm-tag muted">{plan.code}</span>
                    {plan.includesCardio && (
                      <span className="adm-tag info">
                        <Dumbbell size={11} /> Cardio
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="adm-price">{formatINR(plan.price)}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text3)",
                      fontWeight: 700,
                      marginTop: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Clock size={10} /> {plan.durationDays} days
                  </div>
                </div>
              </div>

              {plan.description && (
                <p className="adm-rec-bio">{plan.description}</p>
              )}

              <div className="adm-rec-foot">
                <button
                  type="button"
                  onClick={() => setEditing(plan)}
                  className="adm-act gold"
                >
                  <Edit size={15} />
                  <span className="adm-act-label">Edit</span>
                </button>
                {/* Pausing is a one-tap action rather than a field inside the
                    edit sheet — it is the change made most often, usually to
                    pull an offer down in a hurry. */}
                <button
                  type="button"
                  onClick={() => handleToggle(plan)}
                  disabled={togglingId === plan.id}
                  className={`adm-act ${plan.isActive ? "red" : "green"}`}
                  aria-label={`${plan.isActive ? "Pause" : "Activate"} ${plan.name}`}
                >
                  <Power size={15} />
                  <span className="adm-act-label">
                    {plan.isActive ? "Pause" : "Activate"}
                  </span>
                </button>
              </div>
            </article>
          ))}
          </div>
        </section>
      ))}

      {editing && (
        <Sheet onClose={() => setEditing(null)} title={`Edit · ${editing.name}`}>
          <p className="adm-hint" style={{ marginBottom: 14 }}>
            {editing.branchName} · {editing.code}
          </p>

          <form action={(fd) => handleUpdate(editing.id, fd)}>
            <div className="adm-field">
              <label className="adm-label" htmlFor="pl-name">
                Plan Name *
              </label>
              <input
                id="pl-name"
                name="name"
                required
                defaultValue={editing.name}
                className="adm-input"
              />
            </div>

            <div className="adm-form-grid">
              <div className="adm-field">
                <label className="adm-label" htmlFor="pl-price">
                  Price (₹) *
                </label>
                <input
                  id="pl-price"
                  type="number"
                  name="price"
                  required
                  min={0}
                  defaultValue={editing.price}
                  className="adm-input"
                />
              </div>
              <div className="adm-field">
                <label className="adm-label" htmlFor="pl-days">
                  Duration (days) *
                </label>
                <input
                  id="pl-days"
                  type="number"
                  name="durationDays"
                  required
                  min={1}
                  defaultValue={editing.durationDays}
                  className="adm-input"
                />
              </div>

              <div className="adm-field span2">
                <label className="adm-label" htmlFor="pl-desc">
                  Description
                </label>
                <textarea
                  id="pl-desc"
                  name="description"
                  rows={2}
                  defaultValue={editing.description || ""}
                  placeholder="e.g. Best for beginners, includes 2 PT sessions…"
                  className="adm-textarea"
                />
              </div>

              <div className="adm-field span2">
                <label className="adm-label" htmlFor="pl-order">
                  Display Order
                </label>
                <input
                  id="pl-order"
                  type="number"
                  name="displayOrder"
                  min={0}
                  defaultValue={editing.displayOrder ?? 0}
                  className="adm-input"
                />
                <p className="adm-hint">Lower number shows first on the join page.</p>
              </div>
            </div>

            <label className="adm-switch">
              <span className="adm-switch-text">
                <span className="adm-switch-title">Includes cardio</span>
                <span className="adm-switch-sub">
                  Shown as a bullet on the plan card
                </span>
              </span>
              <input
                type="checkbox"
                name="includesCardio"
                value="true"
                defaultChecked={editing.includesCardio}
              />
              <span className="adm-switch-track" aria-hidden="true" />
            </label>

            <label className="adm-switch" style={{ marginTop: 9 }}>
              <span className="adm-switch-text">
                <span className="adm-switch-title">Active</span>
                <span className="adm-switch-sub">
                  Off hides it from the join page
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
                {loading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}
