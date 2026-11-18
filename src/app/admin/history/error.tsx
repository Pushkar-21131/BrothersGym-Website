"use client";

export default function HistoryError({ reset }: { reset: () => void }) {
  return <div className="adm-pagebody adm-empty">
    <p className="adm-empty-title">History could not be loaded</p>
    <p className="adm-empty-text">Please try again in a moment.</p>
    <button type="button" className="adm-btn" onClick={reset}>Try again</button>
  </div>;
}
