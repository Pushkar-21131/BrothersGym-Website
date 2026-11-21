"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, Search } from "lucide-react";
import { correctPaymentDateAction } from "@/app/actions/dashboard";
import { deleteEquipmentAction, updateEquipmentAction } from "@/app/actions/equipment";
import { dashboardHref, paymentMethodLabel, validReceivedDate, type DashboardExpense, type DashboardPayment, type DashboardTransaction, type LedgerKind } from "@/lib/dashboard-finance";
import { formatGymId, formatINR, gymCycle } from "@/lib/utils";
import { formatDateIn } from "@/lib/whatsapp";

type Props = {
  rows: DashboardTransaction[];
  total: number;
  page: number;
  pages: number;
  kind: LedgerKind;
  cycle: string;
  query: string;
  today: string;
  showBranch: boolean;
};

export default function DashboardTransactions({ rows, total, page, pages, kind, cycle, query, today, showBranch }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; cycle?: string } | null>(null);
  const [refreshing, startRefresh] = useTransition();

  function saved(text: string, nextCycle?: string) {
    setEditing(null);
    setNotice({ text, cycle: nextCycle });
    router.refresh();
  }

  return <section id="transactions" className="adm-finance-ledger" aria-labelledby="transactions-title">
    <div className="adm-finance-section-head">
      <h2 id="transactions-title">Transactions</h2>
      <button type="button" className="adm-btn sm" disabled={refreshing} aria-busy={refreshing}
        onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={14} /> {refreshing ? "Refreshing…" : "Refresh"}</button>
    </div>
    <nav className="adm-finance-tabs" aria-label="Transaction type">
      <Link href={dashboardHref(cycle)} className={kind === "payments" ? "active" : ""} aria-current={kind === "payments" ? "page" : undefined}>Membership payments</Link>
      <Link href={dashboardHref(cycle, "equipment")} className={kind === "equipment" ? "active" : ""} aria-current={kind === "equipment" ? "page" : undefined}>Equipment expenses</Link>
    </nav>
    <form className="adm-finance-search" method="get" action="/admin#transactions" key={`${cycle}:${kind}:${query}`}>
      <input type="hidden" name="cycle" value={cycle} />
      <input type="hidden" name="type" value={kind} />
      <div className="adm-search">
        <Search size={16} />
        <input type="search" name="q" defaultValue={query} maxLength={80} aria-label="Search transactions"
          placeholder={kind === "payments" ? "Member name or gym ID" : "Equipment or recorded by"} />
      </div>
      <button type="submit" className="adm-btn">Search</button>
    </form>
    {notice && <p className="adm-finance-notice" role="status">
      {notice.text} {notice.cycle && notice.cycle !== cycle && <Link href={dashboardHref(notice.cycle)}>View that cycle <ChevronRight size={13} /></Link>}
    </p>}
    <p className="adm-finance-list-count">{total} {kind === "payments" ? total === 1 ? "payment" : "payments" : total === 1 ? "expense" : "expenses"}{query ? " matching your search" : " in this cycle"}</p>
    {rows.length === 0 ? <div className="adm-finance-empty">
      <h3>{query ? "No matching transactions" : kind === "payments" ? "No payments in this cycle" : "No equipment expenses in this cycle"}</h3>
      <p>{query ? kind === "payments" ? "Try a member name or gym ID." : "Try an equipment name or the person who recorded it." : "Choose an earlier cycle to review its entries."}</p>
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
            aria-expanded={editing === row.id} onClick={() => { setNotice(null); setEditing(editing === row.id ? null : row.id); }}>
            <Pencil size={14} /><span>{row.kind === "payment" ? "Edit date" : "Edit"}</span>
          </button> : <span className="adm-finance-gateway" title="This verified online payment was recorded automatically">Automatic date</span>}
        </div>
        {editing === row.id && (row.kind === "payment"
          ? <PaymentDateEditor row={row} today={today} onCancel={() => setEditing(null)} onSaved={saved} />
          : <ExpenseEditor row={row} today={today} onCancel={() => setEditing(null)} onSaved={saved} />)}
      </article>)}
    </div>}
    {pages > 1 && <nav className="adm-finance-pagination" aria-label="Transaction pages">
      {page > 1 && <Link href={dashboardHref(cycle, kind, query, page - 1)} className="adm-btn sm"><ChevronLeft size={14} /> Previous</Link>}
      <span>Page {page} of {pages}</span>
      {page < pages && <Link href={dashboardHref(cycle, kind, query, page + 1)} className="adm-btn sm">Next <ChevronRight size={14} /></Link>}
    </nav>}
    {kind === "payments" && <p className="adm-finance-footnote">Profit follows the received date. Date corrections leave the member’s membership period intact.</p>}
  </section>;
}

function PaymentDateEditor({ row, today, onCancel, onSaved }: {
  row: DashboardPayment; today: string; onCancel: () => void; onSaved: (text: string, cycle?: string) => void;
}) {
  const [date, setDate] = useState(row.date);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const target = validReceivedDate(date, today) ? gymCycle(date) : null;

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await correctPaymentDateAction(row.id, date, row.date);
      if ("error" in result && result.error) setError(result.error);
      else if ("cycle" in result) onSaved(`${formatINR(result.amount)} now counts in ${result.cycle.label}.`, result.cycle.start);
    } catch {
      setError("Could not reach the server. Refresh the dashboard before trying again.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return <form action={save} className="adm-finance-editor">
    <div className="adm-field">
      <label className="adm-label" htmlFor={`payment-date-${row.id}`}>Money received on</label>
      <input ref={input} id={`payment-date-${row.id}`} type="date" required max={today} value={date} disabled={saving}
        onChange={(event) => setDate(event.target.value)} className="adm-input" aria-describedby={`payment-cycle-${row.id}`} />
    </div>
    <p id={`payment-cycle-${row.id}`} className="adm-finance-editor-hint" aria-live="polite">{target ? `Counts in ${target.label}. Use the day the money actually came in.` : "Choose a valid date on or before today."}</p>
    {error && <p className="adm-finance-error" role="alert">{error}</p>}
    <div className="adm-finance-editor-actions">
      <button type="submit" disabled={saving || !target} className="adm-btn primary">{saving ? "Saving…" : "Save received date"}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="adm-btn">Cancel</button>
    </div>
  </form>;
}

function ExpenseEditor({ row, today, onCancel, onSaved }: {
  row: DashboardExpense; today: string; onCancel: () => void; onSaved: (text: string, cycle?: string) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  async function remove() {
    if (lock.current || !confirm(`Delete the ${formatINR(row.amount)} expense for ${row.equipmentName}? This will update the cycle's profit.`)) return;
    lock.current = true;
    setSaving(true);
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
    }
  }

  async function save(data: FormData) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
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
