import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { Search } from "lucide-react";

export const Route = createFileRoute("/studio/settings/activity-log")({
  component: ActivityLogPage,
});

interface LogRow {
  id: string;
  created_at: string;
  user_id: string | null;
  action_type: string | null;
  target_type: string | null;
  target_id: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

interface UserLite {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface ClientLite {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
}

const ACTION_GROUPS: Record<string, string[]> = {
  Workflow: ["workflow_materialized", "milestone_created", "milestone_shifted", "milestone_completed"],
  Communication: ["communication_drafted", "communication_sent"],
  "Status Change": ["status_change", "wedding_date_changed", "album_workflow_activated"],
  Override: ["milestone_overridden"],
  "User Action": ["client_added", "task_completed"],
};

const ACTION_COLORS: Record<string, string> = {
  workflow_materialized: "bg-gold/15 text-gold-foreground border-gold/40",
  milestone_created: "bg-sage/15 text-sage-foreground border-sage/40",
  milestone_completed: "bg-sage/15 text-sage-foreground border-sage/40",
  milestone_shifted: "bg-gold/15 text-gold-foreground border-gold/40",
  milestone_overridden: "bg-magenta/15 text-magenta border-magenta/40",
  communication_drafted: "bg-gold/15 text-gold-foreground border-gold/40",
  communication_sent: "bg-sage/15 text-sage-foreground border-sage/40",
  status_change: "bg-primary/10 text-primary border-primary/30",
  wedding_date_changed: "bg-primary/10 text-primary border-primary/30",
  album_workflow_activated: "bg-plum/15 text-plum border-plum/40",
  client_added: "bg-sage/15 text-sage-foreground border-sage/40",
};

const PAGE_SIZE = 50;

function ActivityLogPage() {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<LogRow[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, ClientLite>>({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const today = new Date();
  const sevenAgo = new Date(today);
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const [from, setFrom] = useState(sevenAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [actionGroup, setActionGroup] = useState<string>("All");
  const [targetType, setTargetType] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Owner gate
  useEffect(() => {
    if (authLoading) return;
    if (!profile) return;
    if (profile.role !== "owner") {
      navigate({ to: "/studio" });
    }
  }, [profile, authLoading, navigate]);

  // Load profiles for filter + display
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .order("full_name")
      .then(({ data }) => setUsers(data ?? []));
  }, []);

  const loadPage = async (resetPage: boolean) => {
    setLoading(true);
    const targetPage = resetPage ? 0 : page;
    let q = supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1);

    if (from) q = q.gte("created_at", new Date(from + "T00:00:00").toISOString());
    if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());
    if (actionGroup !== "All") {
      const types = ACTION_GROUPS[actionGroup] ?? [];
      if (types.length) q = q.in("action_type", types);
    }
    if (targetType !== "all") q = q.eq("target_type", targetType);
    if (userFilter === "system") q = q.is("user_id", null);
    else if (userFilter !== "all") q = q.eq("user_id", userFilter);
    if (search.trim()) q = q.ilike("description", `%${search.trim()}%`);

    const { data } = await q;
    const incoming = (data ?? []) as LogRow[];

    setRows((prev) => (resetPage ? incoming : [...prev, ...incoming]));
    setHasMore(incoming.length === PAGE_SIZE);
    setPage(targetPage + 1);
    setLoading(false);

    // Resolve client targets (and metadata.client_id)
    const ids = new Set<string>();
    for (const r of incoming) {
      if (r.target_type === "client" && r.target_id) ids.add(r.target_id);
      const meta = r.metadata as Record<string, unknown> | null;
      const cid = meta?.client_id;
      if (typeof cid === "string") ids.add(cid);
    }
    const need = Array.from(ids).filter((id) => !clientMap[id]);
    if (need.length) {
      const { data: clients } = await supabase
        .from("clients")
        .select("id, couple_name_1, couple_name_2")
        .in("id", need);
      if (clients) {
        setClientMap((m) => {
          const next = { ...m };
          for (const c of clients) next[c.id] = c as ClientLite;
          return next;
        });
      }
    }
  };

  useEffect(() => {
    setPage(0);
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, actionGroup, targetType, userFilter, search]);

  const userMap = useMemo(() => {
    const m: Record<string, UserLite> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  const resolveCoupleId = (r: LogRow): string | null => {
    if (r.target_type === "client" && r.target_id) return r.target_id;
    const meta = r.metadata as Record<string, unknown> | null;
    const cid = meta?.client_id;
    return typeof cid === "string" ? cid : null;
  };

  if (authLoading || (profile && profile.role !== "owner")) {
    return null;
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">Activity Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every action, every timestamp. Owner-only.
        </p>
      </header>

      {/* Filters */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent text-foreground focus:outline-none"
            />
            <span className="uppercase tracking-wider text-muted-foreground ml-2">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent text-foreground focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">Target</span>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="bg-transparent text-foreground focus:outline-none capitalize"
            >
              {["all", "client", "milestone", "message", "contract", "proposal", "invoice"].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground">User</span>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="bg-transparent text-foreground focus:outline-none"
            >
              <option value="all">All</option>
              <option value="system">System</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name ?? "—"}
                </option>
              ))}
            </select>
          </div>
          <div className="relative w-[320px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search descriptions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-sm text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Action group chips */}
        <div className="flex flex-wrap gap-2">
          {["All", ...Object.keys(ACTION_GROUPS)].map((g) => {
            const active = actionGroup === g;
            return (
              <button
                key={g}
                onClick={() => setActionGroup(g)}
                className={`px-3 py-1.5 rounded-sm text-[11px] uppercase tracking-wider border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-surface text-muted-foreground border-border hover:text-primary hover:border-primary/40"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {rows.length === 0 && !loading ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No activity yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3 font-medium w-[140px]">Time</th>
                <th className="px-6 py-3 font-medium w-[180px]">User</th>
                <th className="px-6 py-3 font-medium w-[200px]">Action</th>
                <th className="px-6 py-3 font-medium">Description</th>
                <th className="px-6 py-3 font-medium w-[200px]">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = r.user_id ? userMap[r.user_id] : null;
                const coupleId = resolveCoupleId(r);
                const couple = coupleId ? clientMap[coupleId] : null;
                const colorClass =
                  ACTION_COLORS[r.action_type ?? ""] ?? "bg-muted/30 text-muted-foreground border-border";
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-0 hover:bg-background-alt/40 transition-colors"
                  >
                    <td className="px-6 py-4 text-xs text-muted-foreground" title={new Date(r.created_at).toLocaleString()}>
                      {relativeTime(r.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="h-7 w-7 rounded-full bg-plum text-background flex items-center justify-center text-[10px] font-medium shrink-0">
                          {u?.full_name?.[0]?.toUpperCase() ?? "S"}
                        </span>
                        <span className="font-serif italic text-[13px] text-primary">
                          {u?.full_name ?? "System"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2 py-1 rounded-sm border text-[10px] uppercase tracking-wider ${colorClass}`}
                      >
                        {(r.action_type ?? "—").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">{r.description ?? "—"}</td>
                    <td className="px-6 py-4">
                      {couple ? (
                        <Link
                          to="/studio/clients/$id"
                          params={{ id: couple.id }}
                          className="font-serif italic text-[13px] text-primary hover:underline"
                        >
                          {couple.couple_name_1}
                          {couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {hasMore && rows.length > 0 && (
          <div className="border-t border-border px-6 py-4 text-center">
            <button
              onClick={() => loadPage(false)}
              disabled={loading}
              className="text-xs uppercase tracking-wider text-primary hover:text-primary/80 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
