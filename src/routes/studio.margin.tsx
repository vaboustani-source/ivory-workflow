import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Plus, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsOwner, useAuth } from "@/lib/auth";
import { getStudioFinancials, fmtMoney, type FinancialSnapshot, type ClientLite, type OverheadModel } from "@/lib/financials";
import { parseDateFlexible } from "@/lib/dates";

export const Route = createFileRoute("/studio/margin")({
  component: MarginPage,
});

type OverheadItem = {
  id: string;
  label: string;
  category: string | null;
  amount_cents: number;
  cadence: "monthly" | "annual";
  is_active: boolean;
  display_order: number;
};

type SortKey = "couple" | "revenue" | "direct" | "overhead" | "net" | "margin";

function MarginPage() {
  const isOwner = useIsOwner();
  const { loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isOwner) navigate({ to: "/studio" });
  }, [loading, isOwner, navigate]);

  if (loading) {
    return <p className="font-serif italic text-primary text-center py-16">Loading…</p>;
  }
  if (!isOwner) {
    return (
      <div className="bg-surface rounded-lg p-12 text-center">
        <h1 className="font-serif italic text-2xl text-primary mb-2">Owner only</h1>
        <p className="text-sm text-muted-foreground">This view contains sensitive cost data and is restricted to the studio owner.</p>
      </div>
    );
  }
  return <MarginInner />;
}

function MarginInner() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [years, setYears] = useState<number[]>([currentYear]);
  const [items, setItems] = useState<OverheadItem[]>([]);
  const [expectedWeddings, setExpectedWeddings] = useState<number>(25);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [overhead, setOverhead] = useState<OverheadModel | null>(null);
  const [rows, setRows] = useState<{ client: ClientLite; financials: FinancialSnapshot }[]>([]);
  const [totals, setTotals] = useState<FinancialSnapshot | null>(null);
  const [bookedCount, setBookedCount] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // year list
  useEffect(() => {
    supabase.from("clients").select("wedding_date").not("wedding_date", "is", null).then(({ data }) => {
      const set = new Set<number>([currentYear]);
      (data ?? []).forEach((r: any) => { if (r.wedding_date) set.add(parseDateFlexible(r.wedding_date).getFullYear()); });
      setYears(Array.from(set).sort());
    });
  }, [currentYear]);

  // overhead settings
  const reloadOverhead = async () => {
    const { data: it } = await supabase
      .from("studio_overhead_items")
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    setItems((it ?? []) as OverheadItem[]);
    const { data: s } = await supabase.from("studio_cost_settings").select("id, expected_weddings_per_year").limit(1).maybeSingle();
    if (s) {
      setSettingsId((s as any).id);
      setExpectedWeddings(Number((s as any).expected_weddings_per_year ?? 25));
    }
  };
  useEffect(() => { reloadOverhead(); }, []);

  // financials
  const reloadFinancials = async () => {
    setLoadingData(true);
    const r = await getStudioFinancials(year);
    setRows(r.snapshots);
    setTotals(r.totals);
    setOverhead(r.overhead);
    setBookedCount(r.actual_booked_this_year);
    setLoadingData(false);
  };
  useEffect(() => { reloadFinancials(); }, [year, items, expectedWeddings]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case "couple": av = a.client.couple_name_1; bv = b.client.couple_name_1; break;
        case "revenue": av = a.financials.revenue; bv = b.financials.revenue; break;
        case "direct": av = a.financials.total_costs; bv = b.financials.total_costs; break;
        case "overhead": av = a.financials.overhead_allocation_cents; bv = b.financials.overhead_allocation_cents; break;
        case "net": av = a.financials.net_profit_cents; bv = b.financials.net_profit_cents; break;
        case "margin": av = a.financials.net_margin_pct ?? -Infinity; bv = b.financials.net_margin_pct ?? -Infinity; break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "couple" ? "asc" : "desc"); }
  };

  // Mutations
  const addItem = async () => {
    await supabase.from("studio_overhead_items").insert({
      label: "New overhead", category: "other", amount_cents: 0, cadence: "monthly", is_active: true,
      display_order: items.length,
    });
    reloadOverhead();
  };
  const updateItem = async (id: string, patch: Partial<OverheadItem>) => {
    await supabase.from("studio_overhead_items").update(patch as any).eq("id", id);
    reloadOverhead();
  };
  const deleteItem = async (id: string) => {
    await supabase.from("studio_overhead_items").delete().eq("id", id);
    reloadOverhead();
  };
  const saveExpected = async (n: number) => {
    setExpectedWeddings(n);
    if (settingsId) {
      await supabase.from("studio_cost_settings").update({ expected_weddings_per_year: n } as any).eq("id", settingsId);
    } else {
      const { data } = await supabase.from("studio_cost_settings").insert({ expected_weddings_per_year: n } as any).select("id").maybeSingle();
      if (data) setSettingsId((data as any).id);
    }
    reloadOverhead();
  };

  const annualCents = items.filter(i => i.is_active).reduce((s, i) => s + (i.cadence === "monthly" ? i.amount_cents * 12 : i.amount_cents), 0);
  const perWedCents = Math.floor(annualCents / Math.max(1, expectedWeddings));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif italic text-[28px] text-primary">Profitability</h1>
        <p className="text-sm text-muted-foreground mt-1">True profit per wedding, after overhead. Owner only.</p>
      </div>

      {/* Overhead settings */}
      <div className="bg-surface rounded-lg shadow-soft p-6 mb-6 border-t-2 border-gold">
        <h2 className="font-serif italic text-xl text-primary mb-4">Overhead</h2>

        <div className="grid grid-cols-[1fr_160px_140px_120px_40px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-2">
          <span>Label</span><span>Category</span><span className="text-right">Amount</span><span>Cadence</span><span></span>
        </div>
        <div className="space-y-1">
          {items.map((it) => (
            <div key={it.id} className="grid grid-cols-[1fr_160px_140px_120px_40px] gap-2 items-center bg-background-alt/40 rounded-sm px-2 py-1.5">
              <input value={it.label} onChange={(e) => setItems(items.map(x => x.id === it.id ? { ...x, label: e.target.value } : x))}
                onBlur={(e) => updateItem(it.id, { label: e.target.value })}
                className="bg-transparent text-sm text-foreground px-2 py-1 focus:outline-none focus:bg-surface rounded-sm" />
              <input value={it.category ?? ""} onChange={(e) => setItems(items.map(x => x.id === it.id ? { ...x, category: e.target.value } : x))}
                onBlur={(e) => updateItem(it.id, { category: e.target.value })}
                placeholder="payroll / software / …"
                className="bg-transparent text-sm text-muted-foreground px-2 py-1 focus:outline-none focus:bg-surface rounded-sm" />
              <div className="flex items-center justify-end gap-1">
                <span className="text-muted-foreground text-xs">$</span>
                <input type="number" min={0} value={Math.round(it.amount_cents / 100)}
                  onChange={(e) => setItems(items.map(x => x.id === it.id ? { ...x, amount_cents: Math.round(Number(e.target.value || 0) * 100) } : x))}
                  onBlur={(e) => updateItem(it.id, { amount_cents: Math.round(Number(e.target.value || 0) * 100) })}
                  className="bg-transparent text-sm text-foreground px-2 py-1 w-28 text-right focus:outline-none focus:bg-surface rounded-sm" />
              </div>
              <select value={it.cadence} onChange={(e) => updateItem(it.id, { cadence: e.target.value as "monthly" | "annual" })}
                className="bg-transparent text-sm text-foreground px-2 py-1 focus:outline-none">
                <option value="monthly">monthly</option>
                <option value="annual">annual</option>
              </select>
              <button onClick={() => deleteItem(it.id)} className="text-muted-foreground hover:text-magenta" aria-label="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addItem} className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:text-magenta">
          <Plus size={14} /> Add overhead item
        </button>

        <div className="mt-6 grid grid-cols-2 gap-6 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Expected weddings per year</label>
            <input type="number" min={1} value={expectedWeddings}
              onChange={(e) => setExpectedWeddings(Number(e.target.value || 1))}
              onBlur={(e) => saveExpected(Math.max(1, Number(e.target.value || 1)))}
              className="block mt-1 bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground w-32 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            <p className="text-xs text-muted-foreground mt-1">
              Actual booked in {year}: <span className="text-foreground">{bookedCount}</span> of {expectedWeddings}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Per-wedding overhead</p>
            <p className="font-serif italic text-3xl text-gold">{fmtMoney(perWedCents / 100)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {fmtMoney(annualCents / 100)} annual ÷ {expectedWeddings} = {fmtMoney(perWedCents / 100)} / wedding
            </p>
          </div>
        </div>
      </div>

      {/* Year toggle */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">Year:</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-transparent text-foreground focus:outline-none">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold grid grid-cols-5 gap-6 mb-6">
        <Metric label={`Revenue (${year})`} value={fmtMoney(totals?.revenue ?? 0)} />
        <Metric label="Direct costs" value={fmtMoney(totals?.total_costs ?? 0)} />
        <Metric label="Overhead" value={fmtMoney((totals?.overhead_allocation_cents ?? 0) / 100)} />
        <Metric
          label="Net profit"
          value={fmtMoney((totals?.net_profit_cents ?? 0) / 100)}
          valueClass={(totals?.net_profit_cents ?? 0) >= 0 ? "text-sage" : "text-magenta"}
        />
        <Metric
          label="Blended margin"
          value={totals?.net_margin_pct == null ? "—" : `${totals.net_margin_pct.toFixed(1)}%`}
          valueClass="text-gold"
        />
      </div>

      {/* Per-wedding table */}
      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {loadingData ? (
          <p className="font-serif italic text-primary text-center py-16">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No weddings for {year} yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <Th label="Couple" k="couple" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <Th label="Revenue" k="revenue" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Direct cost" k="direct" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Gross profit" k="direct" sortKey={"direct"} sortDir={sortDir} onClick={() => {}} align="right" />
                <Th label="Overhead" k="overhead" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Net profit" k="net" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <Th label="Margin" k="margin" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ client, financials }) => {
                const net = financials.net_profit_cents / 100;
                return (
                  <tr key={client.id}
                    className="border-b border-border last:border-0 hover:bg-background-alt/40 cursor-pointer"
                    onClick={() => navigate({ to: "/studio/clients/$id", params: { id: client.id }, search: { tab: "financials" } })}
                    title={`Crew $${Math.round(financials.crew_cost_cents/100).toLocaleString()} · Line items $${Math.round(financials.line_item_cost_cents/100).toLocaleString()} · Editing $${Math.round(financials.editing_cost).toLocaleString()} · Other $${Math.round(financials.other_expenses).toLocaleString()}`}
                  >
                    <td className="px-6 py-4">
                      <span className="font-serif italic text-base text-primary">
                        {client.couple_name_1}{client.couple_name_2 ? " & " + client.couple_name_2 : ""}
                      </span>
                      {financials.crew_cost_incomplete && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-gold" title="A crew member is assigned without an agreed total — profit may be optimistic.">
                          <AlertTriangle size={11} /> crew cost not set
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-right tabular-nums text-foreground">{fmtMoney(financials.revenue)}</td>
                    <td className="px-6 py-4 text-sm text-right tabular-nums text-foreground">{fmtMoney(financials.total_costs)}</td>
                    <td className="px-6 py-4 text-sm text-right tabular-nums text-foreground">{fmtMoney(financials.gross_profit_cents / 100)}</td>
                    <td className="px-6 py-4 text-sm text-right tabular-nums text-muted-foreground">{fmtMoney(financials.overhead_allocation_cents / 100)}</td>
                    <td className={`px-6 py-4 text-base text-right tabular-nums font-serif italic ${net >= 0 ? "text-sage" : "text-magenta"}`}>
                      {fmtMoney(net)}
                    </td>
                    <td className={`px-6 py-4 text-sm text-right tabular-nums ${(financials.net_margin_pct ?? 0) >= 0 ? "text-foreground" : "text-magenta"}`}>
                      {financials.net_margin_pct == null ? "—" : `${financials.net_margin_pct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
              {totals && (
                <tr className="bg-background-alt/60 font-medium">
                  <td className="px-6 py-3 text-sm text-primary">Totals</td>
                  <td className="px-6 py-3 text-sm text-right tabular-nums">{fmtMoney(totals.revenue)}</td>
                  <td className="px-6 py-3 text-sm text-right tabular-nums">{fmtMoney(totals.total_costs)}</td>
                  <td className="px-6 py-3 text-sm text-right tabular-nums">{fmtMoney(totals.gross_profit_cents / 100)}</td>
                  <td className="px-6 py-3 text-sm text-right tabular-nums text-muted-foreground">{fmtMoney(totals.overhead_allocation_cents / 100)}</td>
                  <td className={`px-6 py-3 text-sm text-right tabular-nums ${totals.net_profit_cents >= 0 ? "text-sage" : "text-magenta"}`}>
                    {fmtMoney(totals.net_profit_cents / 100)}
                  </td>
                  <td className="px-6 py-3 text-sm text-right tabular-nums">
                    {totals.net_margin_pct == null ? "—" : `${totals.net_margin_pct.toFixed(1)}%`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Direct cost = crew (wedding team) + line-item cost (album, prints) + editing + other expenses.
        Overhead is allocated as annual overhead ÷ expected weddings per year (stable, not affected by booking pace).
      </p>
    </div>
  );
}

function Metric({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`font-serif italic text-2xl text-primary tabular-nums ${valueClass}`}>{value}</p>
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
