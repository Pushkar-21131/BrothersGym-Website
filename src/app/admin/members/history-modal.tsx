"use client";

import { useEffect, useState } from "react";
import { getMemberPaymentHistory } from "@/app/actions/history";
import { TrendingUp, Calendar, AlertTriangle, IndianRupee } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Sheet } from "../sheet";

export default function HistoryModal({
  memberId,
  onClose,
}: {
  memberId: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
        </>
      )}
    </Sheet>
  );
}
