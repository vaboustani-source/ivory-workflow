import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/dates";
import { FileText, Search } from "lucide-react";

export const Route = createFileRoute("/studio/contracts")({
  component: StudioContracts,
});

interface Row {
  id: string;
  title: string | null;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  signature_required_role: string | null;
  client_id: string;
  client: { id: string; couple_name_1: string; couple_name_2: string | null } | null;
  signature_count: number;
}

const STATUSES = ["All", "Draft", "Sent", "Signed", "Other"] as const;
type StatusFilter = typeof STATUSES[number];

const PAGE_SIZE = 50;

function statusTone(s: string): string {
  if (s === "signed") return "bg-sage/20 text-sage";
  if (s === "sent") return "bg-gold/20 text-gold";
  if (s === "draft") return "bg-muted text-muted-foreground";
  return "bg-plum/15 text-plum";
}

function StudioContracts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<"status" | "sent_at" | "signed_at">("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id, title, status, sent_at, signed_at, signature_required_role, client_id, client:clients(id, couple_name_1, couple_name_2)")
        .order("created_at", { ascending: false })
        .limit(2000);

      const ids = (contracts ?? []).map((c: any) => c.id);
      let counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: sigs } = await supabase
          .from("contract_signatures")
          .select("contract_id")
          .in("contract_id", ids);
        (sigs ?? []).forEach((s: any) => counts.set(s.contract_id, (counts.get(s.contract_id) ?? 0) + 1));
      }
      if (cancelled) return;
      setRows(((contracts ?? []) as any[]).map((c) => ({ ...c, signature_count: counts.get(c.id) ?? 0 })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; }, []);
  const sevenDaysAgo = useMemo(() => new Date(Date.now() - 7 * 86400000), []);

  const kpis = useMemo(() => ({
    total: rows.length,
    awaiting: rows.filter((r) => r.status === "sent").length,
    signedThisMonth: rows.filter((r) => r.signed_at && new Date(r.signed_at) >= monthStart).length,
    overdue: rows.filter((r) => r.status === "sent" && r.sent_at && new Date(r.sent_at) < sevenDaysAgo).length,
  }), [rows, monthStart, sevenDaysAgo]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter === "Draft" && r.status !== "draft") return false;
      if (statusFilter === "Sent" && r.status !== "sent") return false;
      if (statusFilter === "Signed" && r.status !== "signed") return false;
      if (statusFilter === "Other" && ["draft", "sent", "signed"].includes(r.status)) return false;
      if (debounced) {
        const q = debounced.toLowerCase();
        const name = ((r.client?.couple_name_1 ?? "") + " " + (r.client?.couple_name_2 ?? "")).toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, debounced]);

  const sorted = useMemo(() => {
    const order: Record<string, number> = { sent: 0, signed: 1, draft: 2 };
    const copy = [...filtered];
    if (sortKey === "status") {
      copy.sort((a, b) => {
        const av = order[a.status] ?? 99, bv = order[b.status] ?? 99;
        return sortDir === "asc" ? av - bv : bv - av;
      });
    } else {
      copy.sort((a, b) => {
        const av = a[sortKey] ? new Date(a[sortKey]!).getTime() : 0;
        const bv = b[sortKey] ? new Date(b[sortKey]!).getTime() : 0;
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }
    return copy;
  }, [filtered, sortKey, sortDir]);

  const visible = sorted.slice(0, page * PAGE_SIZE);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">Contracts</h1>
        <p className="text-sm text-muted-foreground mt-1">Every agreement, every signature.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total contracts" value={kpis.total} />
        <Kpi label="Awaiting signature" value={kpis.awaiting} tone="gold" />
        <Kpi label="Signed this month" value={kpis.signedThisMonth} tone="sage" />
        <Kpi label="Overdue" value={kpis.overdue} tone="magenta" />
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-wider border ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border hover:border-primary/40"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-[320px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by couple…"
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold overflow-hidden">
        {loading ? (
          <p className="font-serif italic text-primary p-8">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="font-serif italic text-2xl text-primary text-center py-16">No contracts to show.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background-alt/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th>Couple</Th>
                <Th>Title</Th>
                <Th onClick={() => toggleSort("status")} active={sortKey === "status"}>Status</Th>
                <Th onClick={() => toggleSort("sent_at")} active={sortKey === "sent_at"}>Sent</Th>
                <Th onClick={() => toggleSort("signed_at")} active={sortKey === "signed_at"}>Signed</Th>
                <Th>Required</Th>
                <Th>Signatures</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const required = r.signature_required_role === "both_partners" ? 2 : 1;
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-background-alt/40">
                    <td className="px-4 py-3">
                      <Link to="/studio/clients/$id" params={{ id: r.client_id }} search={{ tab: "documents", contract_id: r.id } as any} className="font-serif italic text-primary hover:text-magenta">
                        {r.client?.couple_name_1}{r.client?.couple_name_2 ? ` & ${r.client.couple_name_2}` : ""}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[260px]">{r.title ?? "—"}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${statusTone(r.status)}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{r.sent_at ? relativeTime(r.sent_at) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.signed_at ? relativeTime(r.signed_at) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.signature_required_role === "both_partners" ? "Both partners" : "Single"}</td>
                    <td className="px-4 py-3 text-foreground">{r.signature_count} of {required}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {visible.length < sorted.length && (
        <div className="text-center">
          <button onClick={() => setPage((p) => p + 1)} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10">
            Show more ({sorted.length - visible.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "gold" | "sage" | "magenta" }) {
  const cls = tone === "gold" ? "text-gold" : tone === "sage" ? "text-sage" : tone === "magenta" ? "text-magenta" : "text-primary";
  return (
    <div className="bg-surface rounded-lg shadow-soft p-5 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`font-serif italic text-3xl mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <th className={`px-4 py-3 text-left ${onClick ? "cursor-pointer hover:text-primary" : ""} ${active ? "text-primary" : ""}`} onClick={onClick}>{children}</th>
  );
}
