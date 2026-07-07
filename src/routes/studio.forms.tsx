import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/dates";
import { Search } from "lucide-react";
import { FormTemplatesTab } from "@/components/studio/FormTemplatesTab";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/studio/forms")({
  component: StudioForms,
});

function StudioForms() {
  const { profile, roles } = useAuth();
  const canManageTemplates = profile?.role === "owner" || roles.includes("studio_manager") || roles.includes("owner");
  const [tab, setTab] = useState<"sent" | "templates">("sent");

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Forms</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === "sent" ? "What couples have shared with us." : "Manage the master questionnaire templates."}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setTab("sent")}
            className={`px-4 py-2 text-sm ${tab === "sent" ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-background-alt"}`}
          >
            Sent forms
          </button>
          {canManageTemplates && (
            <button
              onClick={() => setTab("templates")}
              className={`px-4 py-2 text-sm border-l border-border ${tab === "templates" ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-background-alt"}`}
            >
              Templates
            </button>
          )}
        </div>
      </header>
      {tab === "sent" ? <SentFormsView /> : <FormTemplatesTab />}
    </div>
  );
}


interface Row {
  id: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  responses: Record<string, any> | null;
  client_id: string;
  created_at: string;
  client: { id: string; couple_name_1: string; couple_name_2: string | null } | null;
  template: { id: string; name: string | null; schema: any } | null;
}

const STATUSES = ["All", "Not started", "In progress", "Complete"] as const;
type StatusFilter = typeof STATUSES[number];
const PAGE_SIZE = 50;

function statusTone(s: string): string {
  if (s === "complete") return "bg-sage/20 text-sage";
  if (s === "in_progress") return "bg-gold/20 text-gold";
  return "bg-muted text-muted-foreground";
}
function statusLabel(s: string) {
  if (s === "complete") return "Complete";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

function progress(r: Row) {
  const schema = Array.isArray(r.template?.schema) ? r.template!.schema : [];
  const total = schema.length;
  const answered = schema.filter((qd: any) => {
    const v = r.responses?.[qd.id];
    return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
  }).length;
  return { answered, total };
}

function SentFormsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("questionnaires")
        .select("id, status, sent_at, completed_at, responses, client_id, created_at, client:clients(id, couple_name_1, couple_name_2), template:questionnaire_templates(id, name, schema)")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (cancelled) return;
      setRows((data ?? []) as any);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; }, []);

  const kpis = useMemo(() => {
    const completed = rows.filter((r) => r.completed_at);
    const completedThisMonth = completed.filter((r) => new Date(r.completed_at!) >= monthStart).length;
    const totalMs = completed.reduce((acc, r) => acc + (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()), 0);
    const avgDays = completed.length > 0 ? totalMs / completed.length / 86400000 : 0;
    return {
      total: rows.length,
      awaiting: rows.filter((r) => r.status === "not_started" || r.status === "in_progress").length,
      completedThisMonth,
      avgDays: avgDays > 0 ? `${avgDays.toFixed(1)}d` : "—",
    };
  }, [rows, monthStart]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter === "Not started" && r.status !== "not_started") return false;
    if (statusFilter === "In progress" && r.status !== "in_progress") return false;
    if (statusFilter === "Complete" && r.status !== "complete") return false;
    if (debounced) {
      const q = debounced.toLowerCase();
      const name = ((r.client?.couple_name_1 ?? "") + " " + (r.client?.couple_name_2 ?? "")).toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  }), [rows, statusFilter, debounced]);

  const sorted = useMemo(() => {
    const order: Record<string, number> = { not_started: 0, in_progress: 1, complete: 2 };
    return [...filtered].sort((a, b) => {
      const av = order[a.status] ?? 99, bv = order[b.status] ?? 99;
      if (av !== bv) return av - bv;
      const at = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.created_at).getTime();
      const bt = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.created_at).getTime();
      return bt - at;
    });
  }, [filtered]);

  const visible = sorted.slice(0, page * PAGE_SIZE);

  return (
    <div className="space-y-6">


      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total forms" value={String(kpis.total)} />
        <Kpi label="Awaiting response" value={String(kpis.awaiting)} tone="gold" />
        <Kpi label="Completed this month" value={String(kpis.completedThisMonth)} tone="sage" />
        <Kpi label="Avg time to complete" value={kpis.avgDays} />
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
          <p className="font-serif italic text-2xl text-primary text-center py-16">No forms to show.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background-alt/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Couple</th>
                <th className="px-4 py-3 text-left">Form</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Submitted</th>
                <th className="px-4 py-3 text-left">Progress</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const { answered, total } = progress(r);
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-background-alt/40">
                    <td className="px-4 py-3">
                      <Link to="/studio/clients/$id" params={{ id: r.client_id }} search={{ tab: "forms", questionnaire_id: r.id } as any} className="font-serif italic text-primary hover:text-magenta">
                        {r.client?.couple_name_1}{r.client?.couple_name_2 ? ` & ${r.client.couple_name_2}` : ""}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[260px]">{r.template?.name ?? "—"}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${statusTone(r.status)}`}>{statusLabel(r.status)}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{r.sent_at ? relativeTime(r.sent_at) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.completed_at ? relativeTime(r.completed_at) : "—"}</td>
                    <td className="px-4 py-3 text-foreground">{answered} of {total}</td>
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

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gold" | "sage" | "magenta" }) {
  const cls = tone === "gold" ? "text-gold" : tone === "sage" ? "text-sage" : tone === "magenta" ? "text-magenta" : "text-primary";
  return (
    <div className="bg-surface rounded-lg shadow-soft p-5 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`font-serif italic text-3xl mt-1 ${cls}`}>{value}</p>
    </div>
  );
}
