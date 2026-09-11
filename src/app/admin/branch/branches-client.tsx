"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { updateBranchAction } from "@/app/actions/branches";
import {
  Building2,
  MapPin,
  Phone,
  User,
  Mail,
  Edit,
  ExternalLink,
} from "lucide-react";
import { Sheet } from "../sheet";

type Branch = {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  mapUrl: string | null;
  // upiId / upiName are on the row (the page passes whole branch records) but
  // deliberately absent from this type — nothing on this screen reads them any
  // more, and declaring them would invite the next edit to render them.
  isActive: boolean;
  createdAt: Date | null;
};

export default function BranchesClient({
  initialBranches,
  canToggleActive,
}: {
  initialBranches: Branch[];
  canToggleActive: boolean;
}) {
  const [editing, setEditing] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleUpdate(id: number, formData: FormData) {
    setLoading(true);
    const result = await updateBranchAction(id, formData);
    setLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success("Branch updated successfully!");
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="adm-pagebody">
      {initialBranches.length === 0 ? (
        <div className="adm-empty">
          <div className="adm-empty-icon">
            <Building2 size={22} />
          </div>
          <p className="adm-empty-title">No branches found</p>
          <p className="adm-empty-text">
            Branches are created by the developer, not from this screen.
          </p>
        </div>
      ) : (
        <div className="adm-list">
        {initialBranches.map((branch) => (
          <article key={branch.id} className="adm-rec">
            <div className="adm-rec-top">
              <div className="adm-rec-ava" style={{ color: "var(--gold)" }}>
                <Building2 size={17} />
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="adm-rec-name">{branch.name}</div>
                <div className="adm-rec-tags">
                  <span className="adm-tag gold">{branch.code}</span>
                  <span className={`adm-tag ${branch.isActive ? "ok" : "off"}`}>
                    {branch.isActive ? "Active" : "Inactive"}
                  </span>
                  {!branch.mapUrl && (
                    <span className="adm-tag warn">No map link</span>
                  )}
                </div>
              </div>
            </div>

            <div className="adm-rec-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="adm-rec-k">
                  <MapPin size={9} style={{ display: "inline", marginRight: 3 }} />
                  Address
                </div>
                <div
                  className="adm-rec-v"
                  style={{ whiteSpace: "normal", lineHeight: 1.5 }}
                >
                  {branch.address}
                </div>
              </div>

              <div>
                <div className="adm-rec-k">Phone</div>
                <div className="adm-rec-v">
                  {branch.phone ? (
                    <a href={`tel:${branch.phone}`} className="adm-link">
                      <Phone size={11} /> {branch.phone}
                    </a>
                  ) : (
                    <span style={{ color: "var(--text3)" }}>—</span>
                  )}
                </div>
              </div>

              <div>
                <div className="adm-rec-k">Owner</div>
                <div className="adm-rec-v">
                  {branch.ownerName ? (
                    <>
                      <User size={11} style={{ display: "inline", marginRight: 3 }} />
                      {branch.ownerName}
                    </>
                  ) : (
                    <span style={{ color: "var(--text3)" }}>—</span>
                  )}
                </div>
              </div>

              {branch.ownerEmail && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="adm-rec-k">Owner Email</div>
                  <div className="adm-rec-v">
                    <a href={`mailto:${branch.ownerEmail}`} className="adm-link">
                      <Mail size={11} /> {branch.ownerEmail}
                    </a>
                  </div>
                </div>
              )}

              {/* The branch's UPI ID and display name used to be shown here. They
                  drove the deleted QR pay screen and nothing reads them now —
                  online payments settle into the branch's Razorpay account, which
                  is configured by env var, not by this form. Showing them would
                  imply otherwise. The columns stay in the database (old rows carry
                  real values); only the UI is gone. */}
            </div>

            <div className="adm-rec-foot">
              <button
                type="button"
                onClick={() => setEditing(branch)}
                className="adm-act gold"
                aria-label={`Edit ${branch.name}`}
              >
                <Edit size={15} />
                <span className="adm-act-label">Edit Branch</span>
              </button>
              {/* Opening the saved map link is the only way to know it is the
                  right pin — the URL itself tells the owner nothing. */}
              {branch.mapUrl && (
                <a
                  href={branch.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adm-act icon"
                  aria-label={`Open ${branch.name} on Google Maps`}
                >
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          </article>
        ))}
        </div>
      )}
      {editing && (
        <Sheet onClose={() => setEditing(null)} title={`Edit ${editing.name}`}>
          <form action={(formData) => handleUpdate(editing.id, formData)}>
            <div className="adm-field">
              <label className="adm-label" htmlFor="br-name">
                Branch Name *
              </label>
              <input
                id="br-name"
                type="text"
                name="name"
                required
                defaultValue={editing.name}
                className="adm-input"
              />
              <p className="adm-hint">
                The branch code ({editing.code}) cannot be changed.
              </p>
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="br-address">
                Full Address *
              </label>
              <textarea
                id="br-address"
                name="address"
                required
                rows={3}
                defaultValue={editing.address}
                className="adm-textarea"
              />
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="br-phone">
                Phone Number
              </label>
              <input
                id="br-phone"
                type="tel"
                name="phone"
                defaultValue={editing.phone || ""}
                placeholder="+917042061402"
                className="adm-input"
              />
              <p className="adm-hint">Include the country code (+91 for India).</p>
            </div>

            <div className="adm-field">
              <label className="adm-label" htmlFor="br-map">
                Google Maps URL
              </label>
              <textarea
                id="br-map"
                name="mapUrl"
                defaultValue={editing.mapUrl || ""}
                placeholder="https://www.google.com/maps/place/..."
                rows={2}
                className="adm-textarea"
              />
              <p className="adm-hint">
                Paste the Maps share link — this is what &quot;Get Directions&quot;
                opens.
              </p>
            </div>

            <div className="adm-form-grid">
              <div className="adm-field">
                <label className="adm-label" htmlFor="br-owner">
                  Owner Name
                </label>
                <input
                  id="br-owner"
                  type="text"
                  name="ownerName"
                  defaultValue={editing.ownerName || ""}
                  placeholder="e.g. Shubhrant Thakur"
                  className="adm-input"
                />
              </div>
              <div className="adm-field">
                <label className="adm-label" htmlFor="br-email">
                  Owner Email
                </label>
                <input
                  id="br-email"
                  type="email"
                  name="ownerEmail"
                  defaultValue={editing.ownerEmail || ""}
                  placeholder="owner@gmail.com"
                  className="adm-input"
                />
              </div>
            </div>

            {/* The "UPI ID" and "UPI Display Name" fields used to sit here. They
                are removed rather than merely hidden, because their own hint text
                said "Money from online joins is sent here — payments go to
                whatever you type", and that is now false: online payments settle
                into the branch's Razorpay account, resolved from
                RAZORPAY_KEY_ID_<CODE> in the environment. An owner who typed a UPI
                ID into a form making that promise would reasonably believe money
                was arriving somewhere it wasn't.

                updateBranchAction no longer reads either field — see the note
                there about why it can't just leave them in the update. */}

            {/* Deactivating a branch hides it from the site AND from
                getAllBranches(), which would lock that branch's own owner out of
                their dashboard. Main owner account only — updateBranchAction
                ignores the field for anyone else. */}
            {canToggleActive && (
              <label className="adm-switch">
                <span className="adm-switch-text">
                  <span className="adm-switch-title">Active branch</span>
                  <span className="adm-switch-sub">
                    Off removes it from the public website
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
            )}

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
