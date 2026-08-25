"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Edit, Trash2, User } from "lucide-react";
import {
  addTrainerAction,
  updateTrainerAction,
  deleteTrainerAction,
} from "@/app/actions/trainers";
import { formatINR } from "@/lib/utils";
import { Sheet } from "../sheet";

type Trainer = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  photoUrl: string | null;
  experience: string;
  ptFee: number;
  isOwner: boolean;
  instagramUrl: string | null;
};

type Branch = { id: number; code: string; name: string };

type Props = {
  initialTrainers: Trainer[];
  showBranchColumn: boolean;
  branches: Branch[];
  currentBranchId: number | null;
  canEdit?: boolean;
};

export default function TrainerList({
  initialTrainers,
  showBranchColumn,
  branches,
  currentBranchId,
  canEdit = true,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Trainer | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const router = useRouter();

  const needsBranchPick = currentBranchId === null;

  async function handleAdd(fd: FormData) {
    setLoading(true);
    const r = await addTrainerAction(fd);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Trainer added!");
      setShowAdd(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, fd: FormData) {
    setLoading(true);
    const r = await updateTrainerAction(id, fd);
    setLoading(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this trainer?")) return;
    setDeletingId(id);
    const r = await deleteTrainerAction(id);
    setDeletingId(null);
    if (r.error) toast.error(r.error);
    else {
      toast.success("Deleted!");
      router.refresh();
    }
  }

  return (
    <div className="adm-pagebody">
      {/* Desktop's stand-in for the FAB. It sits above the list rather than
          below it so it is not a scroll away; on a phone it is display:none
          and the FAB does this job. */}
      {canEdit && (
        <button
          type="button"
          className="adm-btn primary adm-desk-only"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={16} /> Add Trainer / Owner
        </button>
      )}

      {/* These cards are what the public site shows, so the admin view keeps the
          photo prominent — it is the thing most likely to be wrong. */}
      {initialTrainers.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <User size={22} />
          </div>
          <p className="adm-empty-title">No trainers yet</p>
          <p className="adm-empty-text">
            Trainers added here appear on the public site.
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {initialTrainers.map((t) => (
          <article key={t.id} className="adm-rec">
            <div className="adm-rec-top">
              {t.photoUrl ? (
                // Arbitrary owner-entered URLs can't go through next/image
                // without whitelisting every host in next.config.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.photoUrl} alt="" className="adm-rec-ava" />
              ) : (
                <div className="adm-rec-ava">
                  <User size={17} />
                </div>
              )}

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="adm-rec-name">{t.name}</div>
                <div className="adm-rec-tags">
                  {t.isOwner && <span className="adm-tag gold">Owner</span>}
                  {showBranchColumn && t.branchCode && (
                    <span className="adm-tag info">{t.branchCode}</span>
                  )}
                  {!t.photoUrl && <span className="adm-tag warn">No photo</span>}
                  {t.instagramUrl && (
                    <a
                      href={t.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="adm-tag purple"
                    >
                      <InstagramIcon /> Instagram
                    </a>
                  )}
                </div>
              </div>

              <div className="adm-rec-amt">
                {formatINR(t.ptFee)}
                <span
                  style={{
                    display: "block",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "var(--text3)",
                    textAlign: "right",
                  }}
                >
                  PT / month
                </span>
              </div>
            </div>

            <p className="adm-rec-bio">{t.experience}</p>

            {canEdit && (
              <div className="adm-rec-foot">
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="adm-act gold"
                  aria-label={`Edit ${t.name}`}
                >
                  <Edit size={15} />
                  <span className="adm-act-label">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  disabled={deletingId === t.id}
                  className="adm-act icon red"
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </article>
        ))}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          className="adm-fab"
          onClick={() => setShowAdd(true)}
          aria-label="Add trainer"
        >
          <Plus size={18} /> Trainer
        </button>
      )}

      {showAdd && canEdit && (
        <Sheet onClose={() => setShowAdd(false)} title="Add Trainer / Owner">
          <TrainerForm
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
            loading={loading}
            needsBranchPick={needsBranchPick}
            branches={branches}
            submitLabel="Save"
          />
        </Sheet>
      )}

      {editing && canEdit && (
        <Sheet onClose={() => setEditing(null)} title="Edit Trainer">
          <TrainerForm
            onSubmit={(fd) => handleUpdate(editing.id, fd)}
            onCancel={() => setEditing(null)}
            loading={loading}
            branches={branches}
            trainer={editing}
            submitLabel="Update"
          />
        </Sheet>
      )}
    </div>
  );
}

function TrainerForm({
  onSubmit,
  onCancel,
  loading,
  trainer,
  needsBranchPick = false,
  branches,
  submitLabel,
}: {
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  trainer?: Trainer;
  needsBranchPick?: boolean;
  branches: Branch[];
  submitLabel: string;
}) {
  return (
    <form action={onSubmit}>
      {needsBranchPick && (
        <div className="adm-field">
          <label className="adm-label" htmlFor="tr-branch">
            Branch *
          </label>
          <select id="tr-branch" name="branchId" required className="adm-select">
            <option value="">-- Select branch --</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="adm-form-grid">
        <div className="adm-field">
          <label className="adm-label" htmlFor="tr-name">
            Full Name *
          </label>
          <input
            id="tr-name"
            name="name"
            required
            defaultValue={trainer?.name}
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor="tr-fee">
            PT Fee (₹/month) *
          </label>
          <input
            id="tr-fee"
            name="ptFee"
            type="number"
            required
            defaultValue={trainer?.ptFee}
            className="adm-input"
          />
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor="tr-exp">
            Experience / Bio *
          </label>
          <textarea
            id="tr-exp"
            name="experience"
            required
            rows={3}
            defaultValue={trainer?.experience}
            className="adm-textarea"
          />
          <p className="adm-hint">Shown under their photo on the public site.</p>
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor="tr-photo">
            Photo URL (optional)
          </label>
          <input
            id="tr-photo"
            name="photoUrl"
            defaultValue={trainer?.photoUrl || ""}
            placeholder="https://..."
            className="adm-input"
          />
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor="tr-insta">
            Instagram URL (optional)
          </label>
          <input
            id="tr-insta"
            name="instagramUrl"
            defaultValue={trainer?.instagramUrl || ""}
            placeholder="https://instagram.com/username"
            className="adm-input"
          />
        </div>
      </div>

      <label className="adm-switch">
        <span className="adm-switch-text">
          <span className="adm-switch-title">Is an owner</span>
          <span className="adm-switch-sub">
            Adds an OWNER badge to their public card
          </span>
        </span>
        <input
          type="checkbox"
          name="isOwner"
          value="true"
          defaultChecked={trainer?.isOwner ?? false}
        />
        <span className="adm-switch-track" aria-hidden="true" />
      </label>

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <button type="button" onClick={onCancel} className="adm-btn" style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="adm-btn primary"
          style={{ flex: 2 }}
        >
          {loading ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function InstagramIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
