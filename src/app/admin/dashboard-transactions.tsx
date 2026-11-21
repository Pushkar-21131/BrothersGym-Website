"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, Search, X } from "lucide-react";
import { correctPaymentDateAction } from "@/app/actions/dashboard";
import { deleteEquipmentAction, updateEquipmentAction } from "@/app/actions/equipment";
import { dashboardHref, dashboardSummaryHref, paymentMethodLabel, validReceivedDate, type DashboardPeriod, type DashboardExpense, type DashboardPayment, type DashboardTransaction, type LedgerKind } from "@/lib/dashboard-finance";
import { formatGymId, formatINR } from "@/lib/utils";
import { formatDateIn } from "@/lib/whatsapp";

type Props = {
  rows: DashboardTransaction[];
  total: number;
  page: number;
  pages: number;
  kind: LedgerKind;
  period: DashboardPeriod;
  query: string;
  today: string;
  showBranch: boolean;
};

export default function DashboardTransactions({ rows, total, page, pages, kind, period, query, today, showBranch }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; date?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start" });
    panel.current?.focus({ preventScroll: true });
  }, []);

  function saved(text: string, date?: string) {
    setEditing(null);
    setNotice({ text, date });
    router.refresh();
  }

  function close() {
    startRefresh(() => router.push(`${dashboardSummaryHref(period)}#accounts`, { scroll: false }));
  }

  return <section ref={panel} id="transactions" tabIndex={-1} className="adm-finance-ledger" aria-labelledby="transactions-title">
    <div className="adm-finance-section-head">
      <h2 id="transactions-title">Transactions</h2>
      <div className="adm-finance-ledger-controls">
        <button type="button" className="adm-btn sm" disabled={refreshing || saving} aria-busy={refreshing}
          onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={14} aria-hidden="true" /> {refreshing ? "Loading…" : "Refresh"}</button>
        <button type="button" className="adm-btn sm adm-finance-close" disabled={refreshing || saving} aria-label="Close transactions" onClick={close}>
          <X size={16} aria-hidden="true" /><span>Close</span></button>
      </div>
    </div>
    <nav className="adm-finance-tabs" aria-label="Transaction type">
      <Link href={dashboardHref(period)} className={kind === "payments" ? "active" : ""} aria-current={kind === "payments" ? "page" : undefined}>Membership payments</Link>
      <Link href={dashboardHref(period, "equipment")} className={kind === "equipment" ? "active" : ""} aria-current={kind === "equipment" ? "page" : undefined}>Equipment expenses</Link>
    </nav>
    <form className="adm-finance-search" method="get" action="/admin#transactions" key={`${period.start}:${period.end}:${kind}:${query}`}>
      <input type="hidden" name="from" value={period.start} />
      <input type="hidden" name="to" value={period.end} />
      <input type="hidden" name="review" value="1" />
      <input type="hidden" name="type" value={kind} />
      <div className="adm-search">
        <Search size={16} />
        <input type="search" name="q" defaultValue={query} maxLength={80} aria-label="Search transactions"
          placeholder={kind === "payments" ? "Member name or gym ID" : "Equipment or recorded by"} />
      </div>
      <button type="submit" className="adm-btn">Search</button>
    </form>
    {notice && <p className="adm-finance-notice" role="status">
      {notice.text} {notice.date && (notice.date < period.start || notice.date > period.end) && <Link href={dashboardHref({ start: notice.date, end: notice.date })}>View that date <ChevronRight size={13} /></Link>}
    </p>}
    <p className="adm-finance-list-count">{total} {kind === "payments" ? total === 1 ? "payment" : "payments" : total === 1 ? "expense" : "expenses"}{query ? " matching your search" : " in these dates"}</p>
    {rows.length === 0 ? <div className="adm-finance-empty">
      <h3>{query ? "No matching transactions" : kind === "payments" ? "No payments in these dates" : "No equipment expenses in these dates"}</h3>
      <p>{query ? kind === "payments" ? "Try a member name or gym ID." : "Try an equipment name or the person who recorded it." : "Change the date range to review other entries."}</p>
      {kind === "equipment" && <Link href="/admin/equipment">Log an equipment purchase or repair <ChevronRight size={14} /></Link>}
    </div> : <div className="adm-finance-entries">
      {rows.map((row) => <article className={`adm-finance-entry${editing === row.id ? " editing" : ""}`} key={row.id}>
        <div className="adm-finance-entry-line">
          <div className="adm-finance-entry-details">
            <h3>{row.kind === "payment" ? row.memberName ?? "Deleted member" : row.equipmentName}</h3>
            <p>
              {formatDateIn(row.date)} · {row.kind === "payment" ? paymentMethodLabel(row.method) : "Equipment"}
              {row.kind === "payment" && row.gymId !== null && ` · #${formatGymId(row.gymId, row.planType)}`}
              {showBranch && row.branchCode && ` · ${row.branchCode}`}
            </p>
            {row.kind === "payment" && row.recordedDate && row.recordedDate !== row.date && <p className="adm-finance-entry-note">Entered {formatDateIn(row.recordedDate)}</p>}
            {row.kind === "equipment" && row.createdByName && <p className="adm-finance-entry-note">Recorded by {row.createdByName}</p>}
          </div>
          <strong className={`adm-finance-entry-amount${row.kind === "equipment" ? " outgoing" : ""}`}>{row.kind === "equipment" ? "−" : ""}{formatINR(row.amount)}</strong>
          {row.kind === "equipment" || row.canCorrectDate ? <button type="button" className="adm-finance-edit-trigger"
            aria-label={row.kind === "payment" ? `Correct received date for ${row.memberName ?? "deleted member"}` : `Edit ${row.equipmentName}`}
            disabled={saving} aria-expanded={editing === row.id} onClick={() => { setNotice(null); setEditing(editing === row.id ? null : row.id); }}>
            <Pencil size={14} /><span>{row.kind === "payment" ? "Edit date" : "Edit"}</span>
          </button> : <span className="adm-finance-gateway" title="This verified online payment was recorded automatically">Automatic date</span>}
        </div>
        {editing === row.id && (row.kind === "payment"
          ? <PaymentDateEditor row={row} today={today} period={period} onCancel={() => setEditing(null)} onSaved={saved} onBusyChange={setSaving} />
          : <ExpenseEditor row={row} today={today} onCancel={() => setEditing(null)} onSaved={saved} onBusyChange={setSaving} />)}
      </article>)}
    </div>}
    {pages > 1 && <nav className="adm-finance-pagination" aria-label="Transaction pages">
      {page > 1 && <Link href={dashboardHref(period, kind, query, page - 1)} className="adm-btn sm"><ChevronLeft size={14} /> Previous</Link>}
      <span>Page {page} of {pages}</span>
      {page < pages && <Link href={dashboardHref(period, kind, query, page + 1)} className="adm-btn sm">Next <ChevronRight size={14} /></Link>}
    </nav>}
    {kind === "payments" && <p className="adm-finance-footnote">Profit follows the received date. Date corrections leave the member’s membership period intact.</p>}
    <button type="button" className="adm-btn adm-finance-close-bottom" disabled={refreshing || saving} onClick={close}>
      <X size={16} aria-hidden="true" />Close transactions</button>
  </section>;
}

function PaymentDateEditor({ row, today, period, onCancel, onSaved, onBusyChange }: {
  row: DashboardPayment; today: string; period: DashboardPeriod; onCancel: () => void; onSaved: (text: string, date?: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [date, setDate] = useState(row.date);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const valid = validReceivedDate(date, today);
  const included = date >= period.start && date <= period.end;

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await correctPaymentDateAction(row.id, date, row.date);
      if ("error" in result && result.error) setError(result.error);
      else if ("cycle" in result) onSaved(`${formatINR(result.amount)} received on ${formatDateIn(date)}.`, date);
    } catch {
      setError("Could not reach the server. Refresh the dashboard before trying again.");
    } finally {
      lock.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  return <form action={save} className="adm-finance-editor">
    <div className="adm-field">
      <label className="adm-label" htmlFor={`payment-date-${row.id}`}>Money received on</label>
      <input ref={input} id={`payment-date-${row.id}`} type="date" required max={today} value={date} disabled={saving}
        onChange={(event) => setDate(event.target.value)} className="adm-input" aria-describedby={`payment-cycle-${row.id}`} />
    </div>
    <p id={`payment-cycle-${row.id}`} className="adm-finance-editor-hint" aria-live="polite">{valid ? included ? "This date is inside the selected period. Use the day the money actually came in." : "This date is outside the selected period. The payment will leave this list." : "Choose a valid date on or before today."}</p>
    {error && <p className="adm-finance-error" role="alert">{error}</p>}
    <div className="adm-finance-editor-actions">
      <button type="submit" disabled={saving || !valid} className="adm-btn primary">{saving ? "Saving…" : "Save received date"}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="adm-btn">Cancel</button>
    </div>
  </form>;
}

function ExpenseEditor({ row, today, onCancel, onSaved, onBusyChange }: {
  row: DashboardExpense; today: string; onCancel: () => void; onSaved: (text: string, date?: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  async function remove() {
    if (lock.current || !confirm(`Delete the ${formatINR(row.amount)} expense for ${row.equipmentName}? This will update the selected period's profit.`)) return;
    lock.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await deleteEquipmentAction(row.id);
      if (result.error) setError(result.error);
      else onSaved("Equipment expense removed.");
    } catch {
      setError("Could not reach the server. Refresh the dashboard before trying again.");
    } finally {
      lock.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  async function save(data: FormData) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await updateEquipmentAction(row.id, data);
      if (result.error) setError(result.error);
      else onSaved("Equipment expense updated.");
    } catch {
      setError("Could not reach the server. Refresh the dashboard before trying again.");
    } finally {
      lock.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  return <form action={save} className="adm-finance-editor">
    <div className="adm-field"><label className="adm-label" htmlFor={`expense-name-${row.id}`}>Equipment / servicing</label>
      <input id={`expense-name-${row.id}`} name="equipmentName" required defaultValue={row.equipmentName} disabled={saving} className="adm-input" /></div>
    <div className="adm-form-grid">
      <div className="adm-field"><label className="adm-label" htmlFor={`expense-cost-${row.id}`}>Cost (₹)</label>
        <input id={`expense-cost-${row.id}`} type="number" name="cost" required min={1} step={1} defaultValue={row.amount} disabled={saving} className="adm-input" /></div>
      <div className="adm-field"><label className="adm-label" htmlFor={`expense-date-${row.id}`}>Expense date</label>
        <input id={`expense-date-${row.id}`} type="date" name="date" required max={today} defaultValue={row.date} disabled={saving} className="adm-input" /></div>
    </div>
    {error && <p className="adm-finance-error" role="alert">{error}</p>}
    <div className="adm-finance-editor-actions"><button type="submit" disabled={saving} className="adm-btn primary">{saving ? "Saving…" : "Save expense"}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="adm-btn">Cancel</button>
      <button type="button" disabled={saving} onClick={remove} className="adm-btn danger adm-finance-delete">Delete entry</button></div>
  </form>;
}
