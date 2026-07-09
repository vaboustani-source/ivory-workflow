import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, Plus, Search } from "lucide-react";
import { shortDate, relativeTime, parseDateFlexible } from "@/lib/dates";
import { NewClientModal } from "@/components/NewClientModal";

export const Route = createFileRoute("/studio/clients/")({
  component: ClientsList,
});

interface ClientRow {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  status: string;
  last_contacted_at: string | null;
  photographer: { full_name: string | null } | null;
}

const STATUS_DOT: Record<string, string> = {
  lead: "bg-accent",
  booked: "bg-sage",
  active: "bg-magenta",
  delivered: "bg-gold",
  complete: "bg-plum",
  archived: "bg-muted-foreground",
};

function ClientsList() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [photographers, setPhotographers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [photographerFilter, setPhotographerFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("clients")
      .select("id, couple_name_1, couple_name_2, wedding_date, status, last_contacted_at, photographer:profiles!clients_photographer_id_fkey(full_name)")
      .order("wedding_date", { ascending: true, nullsFirst: false });
    setRows((data ?? []) as unknown as ClientRow[]);
  };

  useEffect(() => {
    load();
    supabase.from("profiles").select("id, full_name").in("role", ["owner", "studio_manager", "associate_photographer"]).then(({ data }) => setPhotographers(data ?? []));
  }, []);

  const years = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.wedding_date) set.add(parseDateFlexible(r.wedding_date).getFullYear().toString()); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (yearFilter !== "all" && (!r.wedding_date || new Date(r.wedding_date).getFullYear().toString() !== yearFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${r.couple_name_1} ${r.couple_name_2 ?? ""}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  const isStale = (d: string | null) => {
    if (!d) return false;
    return Date.now() - new Date(d).getTime() > 14 * 24 * 60 * 60 * 1000;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif italic text-[28px] text-primary">Clients</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus size={16} /> New Client
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-[320px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search by name or venue…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <FilterChip label="Status" value={statusFilter} onChange={setStatusFilter} options={["all", "lead", "booked", "active", "delivered", "archived"]} />
        <FilterChip label="Year" value={yearFilter} onChange={setYearFilter} options={["all", ...years]} />
        <FilterChip label="Photographer" value={photographerFilter} onChange={setPhotographerFilter} options={["all", ...photographers.map((p) => p.full_name ?? "—")]} />
      </div>

      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {filtered.length === 0 ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No clients yet. Every story starts here.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3 font-medium">Couple Names</th>
                <th className="px-6 py-3 font-medium">Wedding Date</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Last Contact</th>
                <th className="px-6 py-3 font-medium">Photographer</th>
                <th className="px-6 py-3 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-background-alt/40 transition-colors cursor-pointer">
                  <td className="px-6 py-4">
                    <Link to="/studio/clients/$id" params={{ id: r.id }} className="font-serif italic text-base text-primary block">
                      {r.couple_name_1}{r.couple_name_2 ? " & " + r.couple_name_2 : ""}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground">{r.wedding_date ? shortDate(r.wedding_date) : "—"}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-2 text-sm capitalize">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status] ?? "bg-muted-foreground"}`} />
                      {r.status}
                    </span>
                  </td>
                  <td className={`px-6 py-4 text-sm ${isStale(r.last_contacted_at) ? "text-magenta" : "text-muted-foreground"}`}>
                    {relativeTime(r.last_contacted_at)}
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground">
                    <div className="flex items-center gap-2">
                      <span className="h-7 w-7 rounded-full bg-plum text-background flex items-center justify-center text-[10px] font-medium">
                        {r.photographer?.full_name?.[0]?.toUpperCase() ?? "—"}
                      </span>
                      {r.photographer?.full_name ?? "Unassigned"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link to="/studio/clients/$id" params={{ id: r.id }} className="text-primary"><ChevronRight size={18} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <NewClientModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={load} />
    </div>
  );
}

function FilterChip({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
      <span className="text-muted-foreground uppercase tracking-wider">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-foreground capitalize focus:outline-none">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
