"use client";

import { useEffect, useRef, useState } from "react";
import {
  getMemberPaymentHistory,
  voidPaymentAction,
  restorePaymentAction,
} from "@/app/actions/history";
import toast from "react-hot-toast";
import {
  TrendingUp,
  Calendar,
  AlertTriangle,
  IndianRupee,
  Trash2,
  Undo2,
} from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Sheet } from "../sheet";

export default function HistoryModal({
  memberId,
  canDelete,
  onClose,
}: {
  memberId: number;
  /** Same permission the server checks — the button is hidden, not just refused. */
  canDelete: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // The same lock as the renew button, for the same reason: `busy` has to close
  // before the next tap is handled, and a state update cannot. One tap, one write.
  const busy = useRef(false);

  useEffect(() => {
    getMemberPaymentHistory(memberId)
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch(() => {
        setData({ error: "Failed to load history. Please try again." });
        setLoading(false);
      });
  }, [memberId]);

  // Re-read rather than patch the list in place: the total, the payment count
  // and the gaps are all derived server-side, so moving one row locally would
  // leave three numbers on screen describing the old list. `loading` is left
  // alone, so what is already there stays put until the new answer lands.
  async function refresh() {
    try {
      setData(await getMemberPaymentHistory(memberId));
    } catch {
      toast.error("Could not refresh the history — reopen this sheet.");
    }
  }

  async function change(
    call: (id: number) => Promise<{ error?: string; success?: boolean }>,
    entry: any,
    done: string
  ) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await call(entry.id);
      if (r.error) toast.error(r.error);
      else {
        toast.success(done);
        await refresh();
      }
    } catch {
      // Silence would read as "nothing happened", and the natural next move is
      // to tap again — which is exactly the second write this lock exists for.
      toast.error("No answer from the server — reopen this sheet before trying again.");
    } finally {
      busy.current = false;
    }
  }

  function remove(entry: any) {
    const ok = confirm(
      `Remove ₹${entry.amount} dated ${entry.date} from this member's history?\n\n` +
        `It stops counting in the total and can be put back from the bottom of this sheet.\n\n` +
        `The member's due date does NOT change — correct that in Edit.`
    );
    if (ok) change(voidPaymentAction, entry, "Entry removed");
  }

  // No confirm on the way back: restoring only puts the row where it was, and a
  // second tap on it does nothing.
  function restore(entry: any) {
    change(restorePaymentAction, entry, "Entry put back");
  }

  // The name only arrives with the data, so the title starts generic rather
  // than shifting the sheet's height once it loads.
  const title =
    !loading && data?.member
      ? `${data.member.name} · #${data.member.gymId}`
      : "Payment History";

  return (
    <Sheet onClose={onClose} title={title}>
      {loading ? (
        <p className="adm-hint" style={{ textAlign: "center", padding: "28px 0" }}>
          Loading history…
        </p>
      ) : data?.error ? (
        <p
          className="adm-hint"
          style={{ textAlign: "center", padding: "28px 0", color: "var(--red2)" }}
        >
          {data.error}
        </p>
      ) : (
        <>
          <div className="adm-qstats" style={{ marginTop: 0 }}>
            <div className="adm-qstat">
              <div className="adm-qstat-icon tone-green">
                <IndianRupee size={14} />
              </div>
              <div className="adm-qstat-v" style={{ color: "var(--green2)" }}>
                {formatINR(data.summary.totalPaid)}
              </div>
              <div className="adm-qstat-k">Total paid</div>
            </div>

            <div className="adm-qstat">
              <div className="adm-qstat-icon tone-blue">
                <TrendingUp size={14} />
              </div>
              <div className="adm-qstat-v">{data.summary.totalPayments}</div>
              <div className="adm-qstat-k">Payments</div>
            </div>

            <div className="adm-qstat">
              <div className="adm-qstat-icon tone-gold">
                <Calendar size={14} />
              </div>
              <div className="adm-qstat-v" style={{ fontSize: 13 }}>
                {data.member.joiningDate || "—"}
              </div>
              <div className="adm-qstat-k">First joined</div>
            </div>

            <div className="adm-qstat">
              <div className="adm-qstat-icon tone-red">
                <AlertTriangle size={14} />
              </div>
              <div className="adm-qstat-v" style={{ color: "var(--red2)" }}>
                {data.summary.gapsFound}
              </div>
              <div className="adm-qstat-k">Gaps</div>
            </div>
          </div>

          <h3 className="adm-h2">Timeline · newest first</h3>

          {data.history.length === 0 ? (
            <p className="adm-hint">No payment history yet.</p>
          ) : (
            <section className="adm-card">
              {data.history.map((entry: any) => (
                <div key={entry.id}>
                  <div className="adm-feed-row">
                    <div className="adm-feed-icon tone-green">
                      <IndianRupee size={14} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="adm-feed-title">{formatINR(entry.amount)}</div>
                      <div className="adm-feed-sub">
                        {entry.date} · {(entry.method || "cash").toUpperCase()}
                      </div>
                    </div>

                    {/* No button on a gateway row: that is Razorpay's own record
                        that money moved, and hiding it here would leave the join
                        request and the member's receipt pointing at nothing. */}
                    {canDelete && entry.method !== "razorpay" && (
                      <button
                        onClick={() => remove(entry)}
                        className="adm-act icon red"
                        title="Remove this entry"
                        aria-label={`Remove the ${formatINR(entry.amount)} entry dated ${entry.date}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  {/* A gap means the member stopped paying for a while. It sits
                      under the payment that ended it, which is where the owner
                      is looking when they ask why the dates jump. */}
                  {entry.gapDescription && (
                    <p
                      className="adm-note-text"
                      style={{
                        color: "var(--red2)",
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                        padding: "0 0 11px 41px",
                      }}
                    >
                      <AlertTriangle size={12} style={{ flex: "0 0 auto", marginTop: 2 }} />
                      {entry.gapDescription}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          {data.removed?.length > 0 && (
            <>
              <h3 className="adm-h2">Removed · {data.removed.length}</h3>
              <section className="adm-card">
                {data.removed.map((entry: any) => (
                  <div className="adm-feed-row" key={entry.id}>
                    <div className="adm-feed-icon tone-red">
                      <Trash2 size={14} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="adm-feed-title"
                        style={{ color: "var(--text3)", textDecoration: "line-through" }}
                      >
                        {formatINR(entry.amount)}
                      </div>
                      <div className="adm-feed-sub">
                        {entry.date} · {(entry.method || "cash").toUpperCase()}
                        {entry.voidedBy ? ` · removed by ${entry.voidedBy}` : ""}
                        {entry.voidedAt
                          ? ` on ${new Date(entry.voidedAt).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "2-digit",
                              month: "short",
                            })}`
                          : ""}
                      </div>
                    </div>

                    {canDelete && (
                      <button
                        onClick={() => restore(entry)}
                        className="adm-act icon"
                        title="Put this entry back"
                        aria-label={`Put back the ${formatINR(entry.amount)} entry dated ${entry.date}`}
                      >
                        <Undo2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <p className="adm-hint" style={{ marginTop: 8 }}>
                Removed entries stay on file and are left out of the total above.
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
