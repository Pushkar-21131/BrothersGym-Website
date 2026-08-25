"use client";

import { X } from "lucide-react";

/**
 * Bottom sheet.
 *
 * Slides up from the bottom rather than centring, because on a phone a centred
 * dialog gets shoved off-screen the moment the keyboard opens. Above 900px the
 * CSS centres it as a normal dialog.
 *
 * Lives here rather than beside one page's list because every admin screen
 * opens one, and importing it from the members page made the members page a
 * dependency of screens that have nothing to do with members.
 */
export function Sheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="adm-sheet-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="adm-sheet">
        <div className="adm-sheet-grip" />
        <div className="adm-sheet-head">
          <h2 className="adm-sheet-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="adm-act icon"
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
