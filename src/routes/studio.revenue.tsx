import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/studio/revenue")({
  component: RevenuePage,
});

// READ-ONLY analytics. Gross top-line revenue (invoice totals). No cost/margin.

type InvRow = {
  client_id: string | null;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  total_cents: number | null;
  wedding_date?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAID_STATUSES = new Set(["paid"]);
const SCHEDULED_STATUSES = new Set(["scheduled", "sent", "viewed", "overdue", "reschedule_requested", "draft"]);
// excluded: cancelled, refunded, kill_fee (unless paid)

function fmtUSD(cents: number) {
  return "$" + (Math.round(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUSDShort(cents: number) {
  const d = Math.round(cents / 100);
  if (d >= 1000) return "$" + (d / 1000).toFixed(d >= 10000 ? 0 : 1) + "k";
  return "$" + d.toLocaleString();
}

function RevenuePage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [basis, setBasis] = useState<"payment" | "wedding">("payment");
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("invoices")
        .select("client_id, status, due_date, paid_at, total_cents, client:clients(wedding_date)");
      const mapped: InvRow[] = (data ?? []).map((r: any) => ({
        client_id: r.client_id,
        status: r.status,
        due_date: r.due_date,
        paid_at: r.paid_at,
        total_cents: r.total_cents,
        wedding_date: r.client?.wedding_date ?? null,
      }));
      setRows(mapped);
      setLoading(false);
    })();
  }, []);

  // attribute each invoice to a (year, month) by basis
  function attribute(r: InvRow): { year: number; month: number } | null {
    let date: string | null = null;
    if (basis === "wedding") {
      date = r.wedding_date;
    } else {
      // payment-date / cash basis: paid -> paid_at, otherwise due_date
      const isPaid = PAID_STATUSES.has(r.status);
      date = isPaid ? r.paid_at : r.due_date;
    }
    if (!date) return null;
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  const { monthly, yearTotals, years, hasAnyPaid } = useMemo(() => {
    const monthly: { paid: number; scheduled: number }[] = Array.from({ length: 12 }, () => ({ paid: 0, scheduled: 0 }));
    let yPaid = 0, ySched = 0;
    let anyPaid = false;
    const yearSet = new Set<number>([currentYear]);
    rows.forEach((r) => {
      if (!r.total_cents) return;
      const isPaid = PAID_STATUSES.has(r.status);
      const isSched = SCHEDULED_STATUSES.has(r.status);
      if (!isPaid && !isSched) return; // exclude cancelled/refunded
      if (isPaid) anyPaid = true;
      const att = attribute(r);
      if (!att) return;
      yearSet.add(att.year);
      if (att.year !== year) return;
      if (isPaid) {
        monthly[att.month].paid += r.total_cents;
        yPaid += r.total_cents;
      } else {
        monthly[att.month].scheduled += r.total_cents;
        ySched += r.total_cents;
      }
    });
    const years = Array.from(yearSet).sort();
    return { monthly, yearTotals: { paid: yPaid, scheduled: ySched }, years, hasAnyPaid: anyPaid };
  }, [rows, year, basis, currentYear]);

  const yearTotal = yearTotals.paid + yearTotals.scheduled;
  const maxMonth = Math.max(1, ...monthly.map((m) => m.paid + m.scheduled));
  const monthsWithActivity = monthly.filter((m) => m.paid + m.scheduled > 0).length;
  const avgMonthly = monthsWithActivity > 0 ? yearTotal / monthsWithActivity : 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary">Revenue</h1>
          <p className="text-sm text-muted-foreground mt-1">Monthly income — paid and scheduled.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex bg-surface border border-border rounded-sm overflow-hidden text-xs">
            <button
              onClick={() => setBasis("payment")}
              className={`px-3 py-2 ${basis === "payment" ? "bg-primary text-background" : "text-foreground hover:bg-background-alt/60"}`}
            >By payment date</button>
            <button
              onClick={() => setBasis("wedding")}
              className={`px-3 py-2 ${basis === "wedding" ? "bg-primary text-background" : "text-foreground hover:bg-background-alt/60"}`}
            >By wedding date</button>
          </div>
          <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
            <button onClick={() => setYear((y) => y - 1)} className="text-muted-foreground hover:text-primary px-1">‹</button>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-transparent text-foreground focus:outline-none">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => setYear((y) => y + 1)} className="text-muted-foreground hover:text-primary px-1">›</button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label={`${year} total`} value={fmtUSD(yearTotal)} accent="primary" />
        <StatCard label="Collected so far" value={fmtUSD(yearTotals.paid)} accent="sage" />
        <StatCard label="Outstanding (scheduled)" value={fmtUSD(yearTotals.scheduled)} accent="muted" />
      </div>

      {!hasAnyPaid && yearTotal > 0 && (
        <div className="mb-6 bg-gold/10 border border-gold/30 rounded-sm px-4 py-3 text-sm text-foreground">
          <span className="font-serif italic text-primary">No payments recorded yet</span>
          <span className="text-muted-foreground"> — bars show scheduled / projected income. They'll fill in solid as invoices are paid.</span>
        </div>
      )}

      {loading ? (
        <p className="text-center py-16 text-muted-foreground text-sm">Loading…</p>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-surface rounded-lg shadow-soft p-6 mb-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif italic text-lg text-primary">Monthly · {year}</h2>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary" />Paid</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary/30" />Scheduled</span>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 h-[260px] items-end">
              {monthly.map((m, i) => {
                const total = m.paid + m.scheduled;
                const totalPct = (total / maxMonth) * 100;
                const paidPct = total > 0 ? (m.paid / total) * 100 : 0;
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 h-full justify-end" title={`${MONTHS[i]}: ${fmtUSD(total)} (${fmtUSD(m.paid)} paid · ${fmtUSD(m.scheduled)} scheduled)`}>
                    {total > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{fmtUSDShort(total)}</span>
                    )}
                    <div className="w-full flex flex-col justify-end rounded-sm overflow-hidden" style={{ height: `${totalPct}%`, minHeight: total > 0 ? 4 : 0 }}>
                      {m.scheduled > 0 && (
                        <div className="w-full bg-primary/30" style={{ flex: 100 - paidPct }} />
                      )}
                      {m.paid > 0 && (
                        <div className="w-full bg-primary" style={{ flex: paidPct }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-12 gap-2 mt-2">
              {MONTHS.map((m) => (
                <p key={m} className="text-[11px] text-muted-foreground text-center uppercase tracking-wider">{m}</p>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Scheduled</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => {
                  const total = m.paid + m.scheduled;
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-sm text-foreground">{MONTHS[i]}</td>
                      <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums">{m.paid > 0 ? fmtUSD(m.paid) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums">{m.scheduled > 0 ? fmtUSD(m.scheduled) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums font-medium">{total > 0 ? fmtUSD(total) : <span className="text-muted-foreground font-normal">—</span>}</td>
                    </tr>
                  );
                })}
                <tr className="bg-background-alt/60 border-t-2 border-primary/20">
                  <td className="px-4 py-3 text-sm font-serif italic text-primary">{year} total</td>
                  <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums font-medium">{fmtUSD(yearTotals.paid)}</td>
                  <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums font-medium">{fmtUSD(yearTotals.scheduled)}</td>
                  <td className="px-4 py-3 text-base text-primary text-right tabular-nums font-semibold">{fmtUSD(yearTotal)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider">Avg / active month</td>
                  <td colSpan={2} className="px-4 py-2.5 text-[11px] text-muted-foreground italic">
                    {monthsWithActivity > 0 ? `${monthsWithActivity} month${monthsWithActivity === 1 ? "" : "s"} with activity` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums">{fmtUSD(avgMonthly)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: "primary" | "sage" | "muted" }) {
  const color = accent === "primary" ? "text-primary" : accent === "sage" ? "text-sage" : "text-foreground";
  return (
    <div className="bg-surface rounded-lg shadow-soft px-5 py-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif italic text-2xl tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
