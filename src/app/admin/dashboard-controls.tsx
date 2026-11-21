"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { dashboardPeriodError, type DashboardPeriod, type LedgerKind } from "@/lib/dashboard-finance";

export function DashboardPeriodForm({ period, today, error: initialError, reviewOpen, kind }: {
  period: DashboardPeriod; today: string; error: string | null; reviewOpen: boolean; kind: LedgerKind;
}) {
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end);
  const [error, setError] = useState(initialError);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);

  function validate() {
    const next = dashboardPeriodError(start, end, today);
    setError(next);
    return next;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (validate()) {
      event.preventDefault();
      (dashboardPeriodError(start, start, today) ? startInput : endInput).current?.focus();
    }
  }

  return <form className="adm-finance-range" method="get" action="/admin" onSubmit={submit}>
    <div className="adm-finance-range-fields">
      <div><label className="adm-label" htmlFor="dashboard-from">Start date</label>
        <input ref={startInput} id="dashboard-from" name="from" type="date" required max={today} className="adm-input"
          value={start} onChange={(event) => { setStart(event.target.value); setError(null); }} onBlur={validate} aria-describedby={error ? "dashboard-range-error" : undefined} /></div>
      <div><label className="adm-label" htmlFor="dashboard-to">End date</label>
        <input ref={endInput} id="dashboard-to" name="to" type="date" required min={start} className="adm-input"
          value={end} onChange={(event) => { setEnd(event.target.value); setError(null); }} onBlur={validate} aria-describedby={error ? "dashboard-range-error" : undefined} /></div>
    </div>
    {reviewOpen && <><input type="hidden" name="review" value="1" /><input type="hidden" name="type" value={kind} /></>}
    <div className="adm-finance-range-actions">
      <button type="submit" className="adm-btn primary">Apply dates</button>
      <Link href="/admin" className="adm-finance-reset" prefetch={false}>Current gym cycle</Link>
    </div>
    {error && <p id="dashboard-range-error" className="adm-finance-error" role="alert">{error}</p>}
  </form>;
}

export function ReviewPaymentsButton({ href, count, open }: { href: string; count: number; open: boolean }) {
  const router = useRouter();
  const [pending, startNavigation] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open && window.location.hash === "#accounts") {
      document.getElementById("accounts")?.scrollIntoView({ block: "start" });
      button.current?.focus({ preventScroll: true });
    }
  }, [open]);
  return <button ref={button} id="review-payments" type="button" className="adm-btn primary adm-finance-review"
    disabled={pending} aria-busy={pending} aria-expanded={open} aria-controls="transactions"
    onClick={() => {
      if (open) {
        const panel = document.getElementById("transactions");
        panel?.scrollIntoView({ block: "start" });
        panel?.focus({ preventScroll: true });
      } else startNavigation(() => router.push(href, { scroll: false }));
    }}>
    {pending ? "Loading…" : open ? "View transactions" : `Review ${count} ${count === 1 ? "payment" : "payments"}`}
    <ChevronDown size={16} aria-hidden="true" />
  </button>;
}
