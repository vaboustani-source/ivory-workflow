import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Search, ExternalLink } from "lucide-react";
import { CONTRACTOR_ROLES, type ContractorRole, roleLabel } from "@/lib/contractors";
import { ContractorEditorModal, type ContractorRow } from "@/components/studio/ContractorEditorModal";
import { shortDate, relativeTime } from "@/lib/dates";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/settings/contractors")({
  component: ContractorsPage,
});

type SortKey = "name" | "last_worked" | "jobs";

function ContractorsPage() {
  const [rows, setRows] = useState<ContractorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ContractorRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  const [roleFilter, setRoleFilter] = useState<ContractorRole | "all">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [pendingRequests, setPendingRequests] = useState(0);
  const [bookedThisMonth, setBookedThisMonth] = useState(0);
  const [ytdByContractor, setYtdByContractor] = useState<Map<string, number>>(new Map());
  const [w9Filter, setW9Filter] = useState<"all" | "owes">("all");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("contractors").select("*").order("full_name");
    setRows((data ?? []) as unknown as ContractorRow[]);
    setLoading(false);

    const { count: pendingCount } = await supabase
      .from("contractor_service_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent");
    setPendingRequests(pendingCount ?? 0);

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { count: bookedCount } = await supabase
      .from("wedding_team")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString());
    setBookedThisMonth(bookedCount ?? 0);

    const currentYear = new Date().getFullYear();
    const { data: ytd } = await supabase
      .from("contractor_ytd_pay")
      .select("contractor_id, total_cents")
      .eq("tax_year", currentYear);
    const m = new Map<string, number>();
    ((ytd ?? []) as any[]).forEach((r) => m.set(r.contractor_id, Number(r.total_cents ?? 0)));
    setYtdByContractor(m);
  };

  useEffect(() => { load(); }, []);

  const owesW9 = (r: ContractorRow): boolean => {
    const cents = ytdByContractor.get(r.id) ?? 0;
    return cents >= 60000 && !r.w9_collected;
  };

  const visible = useMemo(() => {
    let v = rows;
    if (activeFilter === "active") v = v.filter((r) => r.is_active);
    if (activeFilter === "inactive") v = v.filter((r) => !r.is_active);
    if (roleFilter !== "all") v = v.filter((r) => r.roles?.includes(roleFilter));
    if (w9Filter === "owes") v = v.filter(owesW9);
    if (search.trim()) {
      const s = search.toLowerCase();
      v = v.filter((r) => r.full_name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s));
    }
    v = [...v];
    if (sort === "name") v.sort((a, b) => a.full_name.localeCompare(b.full_name));
    if (sort === "jobs") v.sort((a, b) => b.jobs_count - a.jobs_count);
    if (sort === "last_worked") v.sort((a, b) => {
      const at = a.last_worked_with_at ? new Date(a.last_worked_with_at).getTime() : 0;
      const bt = b.last_worked_with_at ? new Date(b.last_worked_with_at).getTime() : 0;
      return bt - at;
    });
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeFilter, roleFilter, search, sort, w9Filter, ytdByContractor]);

  const owesCount = useMemo(() => rows.filter(owesW9).length, [rows, ytdByContractor]);

  const totalActive = rows.filter((r) => r.is_active).length;
  const totalInactive = rows.filter((r) => !r.is_active).length;

  const toggleActive = async (c: ContractorRow) => {
    const { error } = await supabase.from("contractors").update({ is_active: !c.is_active }).eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(c.is_active ? "Deactivated" : "Reactivated");
    load();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Contractors directory</h1>
          <p className="text-sm text-muted-foreground mt-1">Independent collaborators we book onto weddings.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
        >
          <Plus size={14} /> Add new contractor
        </button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active" value={totalActive} />
        <Stat label="Inactive" value={totalInactive} />
        <Stat label="Pending requests" value={pendingRequests} />
        <Stat label="Booked this month" value={bookedThisMonth} />
      </div>

      <div className="bg-surface border-t-2 border-gold rounded-lg shadow-soft p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} className="px-3 py-2 bg-background border border-border rounded-md text-sm">
          <option value="all">All roles</option>
          {CONTRACTOR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as any)} className="px-3 py-2 bg-background border border-border rounded-md text-sm">
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="px-3 py-2 bg-background border border-border rounded-md text-sm">
          <option value="name">Sort: Name</option>
          <option value="last_worked">Sort: Last worked</option>
          <option value="jobs">Sort: Jobs count</option>
        </select>
        <button
          type="button"
          onClick={() => setW9Filter(w9Filter === "owes" ? "all" : "owes")}
          className={`px-3 py-2 rounded-md text-xs border ${
            w9Filter === "owes"
              ? "bg-rose-100 text-rose-800 border-rose-300"
              : "bg-background text-muted-foreground border-border hover:text-primary"
          }`}
          title="Show contractors who passed $600 YTD and still owe a W-9"
        >
          Owes W-9{owesCount ? ` (${owesCount})` : ""}
        </button>
      </div>

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No contractors match these filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <div key={c.id} className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="font-serif italic text-lg text-primary">{c.full_name}</h3>
                  {!c.is_active && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">inactive</span>}
                  <W9Indicator
                    cents={ytdByContractor.get(c.id) ?? 0}
                    collected={!!c.w9_collected}
                    requestedAt={c.w9_requested_at ?? null}
                  />
                  {c.instagram && <a href={c.instagram.startsWith("http") ? c.instagram : `https://instagram.com/${c.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="text-xs text-magenta hover:underline inline-flex items-center gap-1">IG <ExternalLink size={10} /></a>}
                  {c.portfolio_url && <a href={c.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-xs text-magenta hover:underline inline-flex items-center gap-1">Portfolio <ExternalLink size={10} /></a>}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(c.roles ?? []).map((r) => (
                    <span key={r} className="text-[10px] uppercase tracking-wider bg-background-alt text-primary px-2 py-0.5 rounded-sm">{roleLabel(r)}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {c.homebase_address ? `Homebase: ${c.homebase_address}` : "No homebase set"}
                  {(c.preferred_min_hourly_rate || c.preferred_max_hourly_rate) && (
                    <> · ${c.preferred_min_hourly_rate ?? "?"}–{c.preferred_max_hourly_rate ?? "?"}/hr</>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {c.jobs_count} job{c.jobs_count === 1 ? "" : "s"} ·{" "}
                  Last worked: {c.last_worked_with_at ? shortDate(c.last_worked_with_at) : "Never"}
                  {c.last_worked_with_at && <> ({relativeTime(c.last_worked_with_at)})</>}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setEditing(c)} className="text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10">Edit</button>
                <button onClick={() => toggleActive(c)} className="text-xs border border-border text-muted-foreground px-3 py-1.5 rounded-md hover:text-primary">
                  {c.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <ContractorEditorModal onClose={() => setCreating(false)} onSaved={load} />}
      {editing && <ContractorEditorModal existing={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="font-serif text-[28px] text-primary leading-none mt-2">{value}</p>
    </div>
  );
}

function W9Indicator({
  cents, collected, requestedAt,
}: {
  cents: number;
  collected: boolean;
  requestedAt: string | null;
}) {
  if (cents < 60000) {
    return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">—</span>;
  }
  if (collected) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-sm">
        W-9 on file
      </span>
    );
  }
  if (requestedAt) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm">
        W-9 requested
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider bg-rose-100 text-rose-800 px-2 py-0.5 rounded-sm">
      W-9 not on file
    </span>
  );
}
