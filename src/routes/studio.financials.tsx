import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { supabase } from "@/integrations/supabase/client";
import { getStudioFinancials, fmtMoney, fmtMargin, type FinancialSnapshot, type ClientLite } from "@/lib/financials";

export const Route = createFileRoute("/studio/financials")({
  component: FinancialsPage,
});

const STATUSES = ["all", "lead", "booked", "active", "delivered", "complete", "archived"] as const;
type SortKey = "couple" | "wedding_date" | "status" | "revenue" | "costs" | "profit" | "margin";

const STATUS_DOT: Record<string, string> = {
  lead: "bg-accent", booked: "bg-sage", active: "bg-magenta",
  delivered: "bg-gold", complete: "bg-plum", archived: "bg-muted-foreground",
};

function FinancialsPage() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [statusFilter, setStatusFilter] = useState<typeof STATUSES[number]>("all");
  const [years, setYears] = useState<number[]>([currentYear]);
  const [rows, setRows] = useState<{ client: ClientLite; financials: FinancialSnapshot }[]>([]);
  const [totals, setTotals] = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("wedding_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    supabase.from("clients").select("wedding_date").not("wedding_date", "is", null).then(({ data }) => {
      const set = new Set<number>();
      (data ?? []).forEach((r: any) => { if (r.wedding_date) set.add(new Date(r.wedding_date).getFullYear()); });
      set.add(currentYear);
      setYears(Array.from(set).sort());
    });
  }, [currentYear]);

  useEffect(() => {
    setLoading(true);
    const filter = statusFilter === "all" ? undefined : [statusFilter];
    getStudioFinancials(year, filter).then((r) => {
      setRows(r.snapshots);
      setTotals(r.totals);
      setLoading(false);
    });
  }, [year, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case "couple": av = a.client.couple_name_1; bv = b.client.couple_name_1; break;
        case "wedding_date": av = a.client.wedding_date ?? ""; bv = b.client.wedding_date ?? ""; break;
        case "status": av = a.client.status; bv = b.client.status; break;
        case "revenue": av = a.financials.revenue; bv = b.financials.revenue; break;
        case "costs": av = a.financials.total_costs; bv = b.financials.total_costs; break;
        case "profit": av = a.financials.profit; bv = b.financials.profit; break;
        case "margin": av = a.financials.margin ?? -Infinity; bv = b.financials.margin ?? -Infinity; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif italic text-[28px] text-primary">Financials</h1>
        <p className="text-sm text-muted-foreground mt-1">Profit & loss across all weddings.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">Year:</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-transparent text-foreground focus:outline-none">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">Status:</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="bg-transparent text-foreground capitalize focus:outline-none">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold grid grid-cols-4 gap-6 mb-6">
        <Metric label={`Total revenue (${year})`} value={fmtMoney(totals?.revenue ?? 0)} />
        <Metric label="Total costs" value={fmtMoney(totals?.total_costs ?? 0)} />
        <Metric
          label="Total profit"
          value={fmtMoney(totals?.profit ?? 0)}
          valueClass={(totals?.profit ?? 0) >= 0 ? "text-sage" : "text-magenta"}
        />
        <Metric label="Average margin" value={fmtMargin(totals?.margin ?? null)} />
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {loading ? (
          <p className="font-serif italic text-primary text-center py-16">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No weddings booked for {year} yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <Th label="Couple" k="couple" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <Th label="Wedding date" k="wedding_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <Th label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <Th label="Revenue" k="revenue" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Costs" k="costs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Profit" k="profit" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Margin" k="margin" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ client, financials }) => (
                <tr
                  key={client.id}
                  className="border-b border-border last:border-0 hover:bg-background-alt/40 cursor-pointer"
                  onClick={() => navigate({ to: "/studio/clients/$id", params: { id: client.id }, search: { tab: "financials" } })}
                >
                  <td className="px-6 py-4">
                    <Link to="/studio/clients/$id" params={{ id: client.id }} search={{ tab: "financials" }} className="font-serif italic text-base text-primary" onClick={(e) => e.stopPropagation()}>
                      {client.couple_name_1}{client.couple_name_2 ? " & " + client.couple_name_2 : ""}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground">{client.wedding_date ? shortDate(client.wedding_date) : "—"}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-2 text-sm capitalize">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[client.status] ?? "bg-muted-foreground"}`} />
                      {client.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-foreground">{fmtMoney(financials.revenue)}</td>
                  <td className="px-6 py-4 text-sm text-right text-foreground">{fmtMoney(financials.total_costs)}</td>
                  <td className={`px-6 py-4 text-sm text-right ${financials.profit >= 0 ? "text-sage" : "text-magenta"}`}>{fmtMoney(financials.profit)}</td>
                  <td className="px-6 py-4 text-sm text-right text-foreground">{fmtMargin(financials.margin)}</td>
                </tr>
              ))}
              {totals && sorted.length > 0 && (
                <tr className="bg-background-alt/60 font-medium">
                  <td className="px-6 py-3 text-sm text-primary">Totals</td>
                  <td></td>
                  <td></td>
                  <td className="px-6 py-3 text-sm text-right text-foreground">{fmtMoney(totals.revenue)}</td>
                  <td className="px-6 py-3 text-sm text-right text-foreground">{fmtMoney(totals.total_costs)}</td>
                  <td className={`px-6 py-3 text-sm text-right ${totals.profit >= 0 ? "text-sage" : "text-magenta"}`}>{fmtMoney(totals.profit)}</td>
                  <td className="px-6 py-3 text-sm text-right text-foreground">{fmtMargin(totals.margin)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`font-serif italic text-2xl text-primary ${valueClass}`}>{value}</p>
    </div>
  );
}

function Th({ label, k, sortKey, sortDir, onClick, align = "left" }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-6 py-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button onClick={() => onClick(k)} className={`inline-flex items-center gap-1 ${active ? "text-primary" : ""}`}>
        {label}
        <ArrowUpDown size={11} className={active ? "opacity-100" : "opacity-40"} />
        {active && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
