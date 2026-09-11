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
import { resolveTrainerPhoto } from "@/lib/trainer-photo";
import { Sheet } from "../sheet";

type Trainer = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  photoUrl: string | null;
  // Set only when a photo was uploaded through this panel. Never the image bytes
  // themselves — those come from /api/trainer-photo/[id], so a 20-trainer list
  // doesn't ship 1.2MB of base64 to the browser.
  photoMime: string | null;
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
        {initialTrainers.map((t) => {
          const photoSrc = resolveTrainerPhoto(t);
          return (
          <article key={t.id} className="adm-rec">
            <div className="adm-rec-top">
              {photoSrc ? (
                // An uploaded photo comes from our own route; a legacy photoUrl is
                // an arbitrary owner-entered host. Neither can go through
                // next/image without whitelisting every host in next.config.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoSrc} alt="" className="adm-rec-ava" />
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
                  {!photoSrc && <span className="adm-tag warn">No photo</span>}
                  {/* A trainer still on an external link is flagged: those are
                      the rows that silently break when the host drops them, and
                      re-uploading is the fix. */}
                  {!t.photoMime && t.photoUrl && (
                    <span className="adm-tag warn">External link</span>
                  )}
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
          );
        })}
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

/**
 * Longest edge of a stored trainer photo, in pixels.
 *
 * The public card renders it at roughly 300–400px wide, so 800 covers a 2x
 * retina display with room to spare and there is nothing to gain from keeping the
 * 3000px original a phone camera produces.
 */
const PHOTO_MAX_EDGE = 800;

/** Target for the first compression pass. Well under the server's 200KB cap. */
const PHOTO_BYTE_BUDGET = 120 * 1024;

/** Decoded byte count of a base64 data URL, without allocating the buffer. */
function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Downscale and re-encode a chosen photo to a JPEG data URL, in the browser.
 *
 * Same technique as the payment screenshot in join-plans-client, and the same two
 * reasons: it keeps the upload inside a server action's default 1MB body without
 * needing an object store, and re-encoding through a canvas drops EXIF — which
 * for a trainer photo taken on a phone means stripping the GPS coordinates of
 * wherever it was shot before publishing it to the world.
 *
 * The quality ladder exists so picking a large file is never a dead end: a 4MB
 * camera photo that overshoots on the first pass gets progressively cheaper
 * encodings rather than a rejection the owner can't act on.
 */
async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const render = (maxEdge: number, quality: number): string => {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-canvas");
      // JPEG has no alpha; without this a transparent PNG logo goes black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      return canvas.toDataURL("image/jpeg", quality);
    };

    const attempts: Array<[number, number]> = [
      [PHOTO_MAX_EDGE, 0.82],
      [PHOTO_MAX_EDGE, 0.7],
      [PHOTO_MAX_EDGE, 0.55],
      [560, 0.55],
    ];

    let out = "";
    for (const [edge, quality] of attempts) {
      out = render(edge, quality);
      if (dataUrlBytes(out) <= PHOTO_BYTE_BUDGET) return out;
    }
    // Return the smallest attempt regardless — the server's message is more
    // precise than anything guessed here.
    return out;
  } finally {
    bitmap.close();
  }
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
  // The compressed data URL to upload. Empty means "no new photo chosen", which
  // the action reads as leave-the-existing-one-alone.
  const [photoData, setPhotoData] = useState("");
  // What the preview shows: a newly picked file if there is one, otherwise
  // whatever this trainer already has saved.
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    trainer ? resolveTrainerPhoto(trainer) : null
  );
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoKB, setPhotoKB] = useState<number | null>(null);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoBusy(true);
    setPhotoError(null);
    try {
      // Generous, and checked before compression: this only exists to reject a
      // video or a RAW file early rather than hanging the browser decoding it.
      if (file.size > 25 * 1024 * 1024) {
        throw new Error("too-big");
      }
      const dataUrl = await compressPhoto(file);
      setPhotoData(dataUrl);
      setPhotoPreview(dataUrl);
      setPhotoKB(Math.max(1, Math.round(dataUrlBytes(dataUrl) / 1024)));
      // Picking a file overrides an earlier "remove": the owner's latest action
      // is the one they meant.
      setRemovePhoto(false);
    } catch {
      setPhotoError("Couldn't read that image. Try a JPG or PNG.");
      setPhotoData("");
      setPhotoKB(null);
    } finally {
      setPhotoBusy(false);
      // Clear the input so re-picking the same file fires onChange again.
      e.target.value = "";
    }
  }

  function clearPhoto() {
    setPhotoData("");
    setPhotoPreview(null);
    setPhotoKB(null);
    setPhotoError(null);
    // Only meaningful when editing — on a new trainer there is nothing stored to
    // remove, and the action treats "clear" and "none" the same on insert.
    setRemovePhoto(Boolean(trainer));
  }

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
          <label className="adm-label" htmlFor="tr-photo-file">
            Photo (optional)
          </label>

          {/* preview is whichever of the three states applies: a freshly picked
              file, the photo already saved on this trainer, or nothing. */}
          <div className="adm-photo-pick">
            <div className="adm-photo-prev">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="" />
              ) : (
                <User size={20} />
              )}
            </div>

            <div className="adm-photo-ctl">
              <input
                id="tr-photo-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPickPhoto}
                disabled={photoBusy}
                className="adm-photo-file"
              />
              {photoBusy && (
                <span className="adm-photo-note">Preparing photo…</span>
              )}
              {!photoBusy && photoError && (
                <span className="adm-photo-note err">{photoError}</span>
              )}
              {!photoBusy && !photoError && photoKB !== null && (
                <span className="adm-photo-note ok">
                  Ready to save · {photoKB}KB after compression
                </span>
              )}
              {!photoBusy && !photoError && photoKB === null && (
                <span className="adm-photo-note">
                  JPG, PNG or WebP. Resized automatically — a photo straight off
                  your phone is fine.
                </span>
              )}
              {photoPreview && (
                <button
                  type="button"
                  className="adm-photo-rm"
                  onClick={clearPhoto}
                  disabled={photoBusy}
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          {/* The compressed data URL rides along as a normal form field, so the
              server action reads it out of FormData like any other input. */}
          <input type="hidden" name="photoData" value={photoData} />
          {/* Tells the action to null the columns, which is different from simply
              not sending a photo — see readPhotoIntent. */}
          <input
            type="hidden"
            name="removePhoto"
            value={removePhoto ? "true" : "false"}
          />
          {/* The old externally-hosted URL is preserved rather than dropped: rows
              still using one keep working, and an upload takes precedence. It is
              no longer editable here because a pasted link is what broke every
              original trainer photo when the host deleted them.

              Cleared along with everything else on Remove, though. Without that,
              removing the photo of a trainer whose only photo IS a link would
              null the upload columns, resubmit the link untouched, and the photo
              the owner just removed would come straight back. */}
          <input
            type="hidden"
            name="photoUrl"
            value={removePhoto ? "" : trainer?.photoUrl || ""}
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
