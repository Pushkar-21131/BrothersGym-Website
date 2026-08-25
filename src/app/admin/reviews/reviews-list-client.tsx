"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Edit, Trash2, Star, Eye, EyeOff, MessageSquareQuote } from "lucide-react";
import {
  addReviewAction,
  updateReviewAction,
  deleteReviewAction,
} from "@/app/actions/reviews";
import { Sheet } from "../sheet";

type Review = {
  id: number;
  memberName: string;
  rating: number;
  reviewText: string;
  memberSince: string | null;
  photoUrl: string | null;
  isVisible: boolean;
  displayOrder: number | null;
  createdAt: Date | null;
};

type Props = {
  initialReviews: Review[];
  canEdit?: boolean;
};

type FilterKey = "all" | "visible" | "hidden";

export default function ReviewsListClient({
  initialReviews,
  canEdit = true,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const router = useRouter();

  const counts = useMemo(() => {
    const visible = initialReviews.filter((r) => r.isVisible).length;
    return {
      all: initialReviews.length,
      visible,
      hidden: initialReviews.length - visible,
    };
  }, [initialReviews]);

  const filtered = useMemo(() => {
    if (filter === "visible") return initialReviews.filter((r) => r.isVisible);
    if (filter === "hidden") return initialReviews.filter((r) => !r.isVisible);
    return initialReviews;
  }, [initialReviews, filter]);

  async function handleAdd(formData: FormData) {
    setLoading(true);
    const result = await addReviewAction(formData);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success("Review added!");
      setShowAdd(false);
      router.refresh();
    }
  }

  async function handleUpdate(id: number, formData: FormData) {
    setLoading(true);
    const result = await updateReviewAction(id, formData);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success("Review updated!");
      setEditing(null);
      router.refresh();
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete review from "${name}"?`)) return;
    setDeletingId(id);
    const result = await deleteReviewAction(id);
    setDeletingId(null);
    if (result.error) toast.error(result.error);
    else {
      toast.success("Review deleted!");
      router.refresh();
    }
  }

  const chips: { key: FilterKey; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "visible", label: "Live", n: counts.visible },
    { key: "hidden", label: "Hidden", n: counts.hidden },
  ];

  return (
    <div className="adm-pagebody">
      {/* Desktop's stand-in for the FAB — above the list so it is not a scroll
          away. display:none on a phone, where the FAB does this job. */}
      {canEdit && (
        <button
          type="button"
          className="adm-btn primary adm-desk-only"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={16} /> Add Review
        </button>
      )}

      <div className="adm-chips">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={`adm-chip${filter === c.key ? " active" : ""}`}
            aria-pressed={filter === c.key}
          >
            {c.label} <span>{c.n}</span>
          </button>
        ))}
      </div>

      {/* A hidden review still exists, so the card shows its state rather than
          removing it — the owner needs to see what is being held back. */}
      {filtered.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <MessageSquareQuote size={22} />
          </div>
          <p className="adm-empty-title">
            {filter === "all" ? "No reviews yet" : "Nothing in this filter"}
          </p>
          <p className="adm-empty-text">
            {filter === "all"
              ? canEdit
                ? "Add one and it shows on the homepage straight away."
                : "Reviews appear on the public homepage."
              : "Try the All filter."}
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {filtered.map((r) => (
          <article
            key={r.id}
            className="adm-rec"
            style={r.isVisible ? undefined : { opacity: 0.62 }}
          >
            <div className="adm-rec-top">
              <div className="adm-rec-ava">{r.memberName.charAt(0)}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="adm-rec-name">{r.memberName}</div>
                <div className="adm-rec-tags">
                  <span
                    className={`adm-tag ${r.isVisible ? "ok" : "muted"}`}
                  >
                    {r.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                    {r.isVisible ? "Live" : "Hidden"}
                  </span>
                  {r.memberSince && (
                    <span className="adm-tag muted">{r.memberSince}</span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 2, paddingTop: 3 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={13}
                    fill={s <= r.rating ? "var(--gold)" : "none"}
                    style={{
                      color: s <= r.rating ? "var(--gold)" : "var(--surface4)",
                    }}
                  />
                ))}
              </div>
            </div>

            <p className="adm-rec-bio">&ldquo;{r.reviewText}&rdquo;</p>

            {canEdit && (
              <div className="adm-rec-foot">
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="adm-act gold"
                  aria-label={`Edit review by ${r.memberName}`}
                >
                  <Edit size={15} />
                  <span className="adm-act-label">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(r.id, r.memberName)}
                  disabled={deletingId === r.id}
                  className="adm-act icon red"
                  aria-label={`Delete review by ${r.memberName}`}
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
          aria-label="Add review"
        >
          <Plus size={18} /> Review
        </button>
      )}

      {showAdd && canEdit && (
        <Sheet onClose={() => setShowAdd(false)} title="Add Review">
          <ReviewForm
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
            loading={loading}
            submitLabel="Save Review"
          />
        </Sheet>
      )}

      {editing && canEdit && (
        <Sheet onClose={() => setEditing(null)} title="Edit Review">
          <ReviewForm
            initialData={editing}
            onSubmit={(fd) => handleUpdate(editing.id, fd)}
            onCancel={() => setEditing(null)}
            loading={loading}
            submitLabel="Update Review"
          />
        </Sheet>
      )}
    </div>
  );
}

function ReviewForm({
  initialData,
  onSubmit,
  onCancel,
  loading,
  submitLabel,
}: {
  initialData?: Review;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  submitLabel: string;
}) {
  return (
    <form action={onSubmit}>
      <div className="adm-form-grid">
        <div className="adm-field">
          <label className="adm-label" htmlFor="rv-name">
            Member Name *
          </label>
          <input
            id="rv-name"
            name="memberName"
            defaultValue={initialData?.memberName}
            required
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor="rv-rating">
            Rating *
          </label>
          <select
            id="rv-rating"
            name="rating"
            defaultValue={initialData?.rating || 5}
            required
            className="adm-select"
          >
            <option value={5}>⭐⭐⭐⭐⭐ (5)</option>
            <option value={4}>⭐⭐⭐⭐ (4)</option>
            <option value={3}>⭐⭐⭐ (3)</option>
            <option value={2}>⭐⭐ (2)</option>
            <option value={1}>⭐ (1)</option>
          </select>
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor="rv-text">
            Review Text *
          </label>
          <textarea
            id="rv-text"
            name="reviewText"
            defaultValue={initialData?.reviewText}
            required
            rows={4}
            placeholder="What does the member say about the gym?"
            className="adm-textarea"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor="rv-since">
            Member Since
          </label>
          <input
            id="rv-since"
            name="memberSince"
            defaultValue={initialData?.memberSince || ""}
            placeholder="e.g. Member since 2022"
            className="adm-input"
          />
        </div>

        <div className="adm-field">
          <label className="adm-label" htmlFor="rv-order">
            Display Order
          </label>
          <input
            id="rv-order"
            type="number"
            name="displayOrder"
            defaultValue={initialData?.displayOrder ?? 0}
            className="adm-input"
          />
          <p className="adm-hint">Lower shows first.</p>
        </div>

        <div className="adm-field span2">
          <label className="adm-label" htmlFor="rv-photo">
            Photo URL (optional)
          </label>
          <input
            id="rv-photo"
            name="photoUrl"
            defaultValue={initialData?.photoUrl || ""}
            placeholder="https://..."
            className="adm-input"
          />
        </div>
      </div>

      {/* Only offered when editing: a new review goes live by default, so the
          switch would just be a way to add work that is never seen. */}
      {initialData && (
        <label className="adm-switch">
          <span className="adm-switch-text">
            <span className="adm-switch-title">Show on homepage</span>
            <span className="adm-switch-sub">
              Turn off to hide it without deleting it
            </span>
          </span>
          <input
            type="checkbox"
            name="isVisible"
            value="true"
            defaultChecked={initialData.isVisible}
          />
          <span className="adm-switch-track" aria-hidden="true" />
        </label>
      )}

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
