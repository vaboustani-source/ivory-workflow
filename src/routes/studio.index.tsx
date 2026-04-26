import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope, useViewAs } from "@/lib/view-as";
import { editorialDate, firstName, shortDate, relativeTime } from "@/lib/dates";
import { AlertCircle, Check } from "lucide-react";

export const Route = createFileRoute("/studio/")({
  component: Dashboard,
});

interface KPIs { activeClients: number; weddingsThisMonth: number; overdueTasks: number; approvalQueue: number; }
interface TaskRow { id: string; title: string | null; client_id: string | null; due_date: string | null; status: string; client?: { couple_name_1: string; couple_name_2: string | null } | null; }
interface ClientStaleRow { id: string; couple_name_1: string; couple_name_2: string | null; last_contacted_at: string | null; }
interface WeekItem { id: string; date: string; title: string; type: "Wedding" | "Engagement" | "Consultation"; subtitle: string; }

function Dashboard() {
  const { profile } = useAuth();
  const { effectiveUserId, isRealOwner, viewingAs } = useViewAs();
  const { scopeClientIds } = useEffectiveScope();
  const [kpis, setKpis] = useState<KPIs>({ activeClients: 0, weddingsThisMonth: 0, overdueTasks: 0, approvalQueue: 0 });
  const [todaysTasks, setTodaysTasks] = useState<TaskRow[]>([]);
  const [staleClients, setStaleClients] = useState<ClientStaleRow[]>([]);
  const [overdueTaskRows, setOverdueTaskRows] = useState<TaskRow[]>([]);
  const [weekItems, setWeekItems] = useState<WeekItem[]>([]);
  const [oldDrafts, setOldDrafts] = useState<number>(0);
  const [unsignedContracts, setUnsignedContracts] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    if (!effectiveUserId) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndISO = weekEnd.toISOString().slice(0, 10);
    const staleCutoff = new Date(today); staleCutoff.setDate(staleCutoff.getDate() - 14);
    const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const ids = await scopeClientIds();
    const inIds = (q: ReturnType<typeof supabase.from> extends infer T ? T : never) => q;
    void inIds;

    const scopeClients = <T extends { in: (col: string, vals: string[]) => T; eq: (col: string, val: string) => T }>(q: T, col = "id"): T => {
      if (ids === null) return q;
      return ids.length > 0 ? q.in(col, ids) : q.eq(col, "00000000-0000-0000-0000-000000000000");
    };

    // KPIs
    const active = await scopeClients(supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "active"));
    const weddings = await scopeClients(supabase.from("clients").select("id", { count: "exact", head: true }).gte("wedding_date", monthStart).lte("wedding_date", monthEnd));
    const overdueCount = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", effectiveUserId).eq("status", "pending").lt("due_date", todayISO);
    const approvalQ = await scopeClients(supabase.from("scheduled_communications").select("id", { count: "exact", head: true }).eq("status", "awaiting_approval"), "client_id");

    setKpis({
      activeClients: active.count ?? 0,
      weddingsThisMonth: weddings.count ?? 0,
      overdueTasks: overdueCount.count ?? 0,
      approvalQueue: approvalQ.count ?? 0,
    });

    // Today's focus
    const todays = await supabase.from("tasks").select("id, title, client_id, due_date, status, client:clients(couple_name_1, couple_name_2)").eq("assignee_id", effectiveUserId).eq("status", "pending").lte("due_date", todayISO).order("priority", { ascending: false }).limit(3);
    setTodaysTasks((todays.data ?? []) as TaskRow[]);

    // Stale clients
    const staleQ = await scopeClients(supabase.from("clients").select("id, couple_name_1, couple_name_2, last_contacted_at").in("status", ["active", "booked"]).lt("last_contacted_at", staleCutoff.toISOString()).order("last_contacted_at", { ascending: true }).limit(5));
    setStaleClients((staleQ.data ?? []) as ClientStaleRow[]);

    // Overdue tasks
    const overdueRows = await supabase.from("tasks").select("id, title, client_id, due_date, status, client:clients(couple_name_1, couple_name_2)").eq("assignee_id", effectiveUserId).eq("status", "pending").lt("due_date", todayISO).order("due_date").limit(5);
    setOverdueTaskRows((overdueRows.data ?? []) as TaskRow[]);

    // Drafts >7d old
    const oldDraftsQ = await scopeClients(supabase.from("scheduled_communications").select("id", { count: "exact", head: true }).eq("status", "awaiting_approval").lt("created_at", sevenDaysAgo.toISOString()), "client_id");
    setOldDrafts(oldDraftsQ.count ?? 0);

    // Unsigned contracts >7d
    const unsignedQ = await scopeClients(supabase.from("contracts").select("id", { count: "exact", head: true }).neq("status", "signed").lt("sent_at", sevenDaysAgo.toISOString()), "client_id");
    setUnsignedContracts(unsignedQ.count ?? 0);

    // This week
    const upcomingClients = await scopeClients(supabase.from("clients").select("id, couple_name_1, couple_name_2, wedding_date, venue_name").gte("wedding_date", todayISO).lte("wedding_date", weekEndISO));
    const upcomingBookings = await scopeClients(supabase.from("bookings").select("id, scheduled_at, event_type, client_id, client:clients(couple_name_1, couple_name_2)").gte("scheduled_at", today.toISOString()).lte("scheduled_at", weekEnd.toISOString()), "client_id");
    const upcomingEng = await scopeClients(supabase.from("engagement_sessions").select("id, scheduled_at, location, client_id, client:clients(couple_name_1, couple_name_2)").gte("scheduled_at", today.toISOString()).lte("scheduled_at", weekEnd.toISOString()), "client_id");

    const items: WeekItem[] = [];
    for (const c of upcomingClients.data ?? []) {
      items.push({ id: `c-${c.id}`, date: shortDate(c.wedding_date), title: `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}`, type: "Wedding", subtitle: c.venue_name ?? "Venue TBD" });
    }
    for (const b of (upcomingBookings.data ?? []) as { id: string; scheduled_at: string; event_type: string | null; client?: { couple_name_1: string; couple_name_2: string | null } | null }[]) {
      items.push({ id: `b-${b.id}`, date: shortDate(b.scheduled_at), title: b.client ? `${b.client.couple_name_1}${b.client.couple_name_2 ? " & " + b.client.couple_name_2 : ""}` : "Booking", type: "Consultation", subtitle: b.event_type?.replace(/_/g, " ") ?? "Call" });
    }
    for (const e of (upcomingEng.data ?? []) as { id: string; scheduled_at: string; location: string | null; client?: { couple_name_1: string; couple_name_2: string | null } | null }[]) {
      items.push({ id: `e-${e.id}`, date: shortDate(e.scheduled_at), title: e.client ? `${e.client.couple_name_1}${e.client.couple_name_2 ? " & " + e.client.couple_name_2 : ""}` : "Engagement", type: "Engagement", subtitle: e.location ?? "Location TBD" });
    }
    setWeekItems(items.sort((a, b) => a.date.localeCompare(b.date)));
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [effectiveUserId, isRealOwner, viewingAs?.id]);

  const completeTask = async (id: string) => {
    await supabase.from("tasks").update({ status: "complete", completed_at: new Date().toISOString(), completed_by: profile?.id }).eq("id", id);
    loadAll();
  };

  const eventColor = (t: WeekItem["type"]) => t === "Wedding" ? "text-primary" : t === "Engagement" ? "text-sage" : "text-plum";

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-serif italic text-[32px] text-primary leading-tight">Good morning, {firstName(profile?.full_name)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{editorialDate()}</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard label="Active clients" value={kpis.activeClients} comparison="—" />
        <KPICard label="Weddings this month" value={kpis.weddingsThisMonth} comparison="—" />
        <KPICard label="Overdue tasks" value={kpis.overdueTasks} comparison={kpis.overdueTasks > 0 ? "Needs attention" : "All caught up"} negative={kpis.overdueTasks > 0} />
        <Link to="/studio/approval-queue">
          <KPICard label="Approval queue" value={kpis.approvalQueue} comparison={kpis.approvalQueue > 0 ? "Awaiting review" : "Clear"} negative={kpis.approvalQueue > 0} />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-8">
        <section className="lg:col-span-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Today's focus</p>
          <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
            {loading ? null : todaysTasks.length === 0 ? (
              <p className="font-serif italic text-lg text-primary">All clear. Nothing on your plate today.</p>
            ) : (
              <ul className="divide-y divide-border">
                {todaysTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <button onClick={() => completeTask(t.id)} className="mt-0.5 h-5 w-5 rounded border-2 border-primary flex items-center justify-center hover:bg-primary/10" aria-label="Complete task">
                      <Check size={12} className="opacity-0 hover:opacity-100" />
                    </button>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{t.title}</p>
                      {t.client && <p className="text-xs text-muted-foreground mt-0.5">{t.client.couple_name_1}{t.client.couple_name_2 ? " & " + t.client.couple_name_2 : ""}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/studio/tasks" className="text-xs text-primary hover:underline inline-block mt-4">View all tasks →</Link>
          </div>
        </section>

        <section className="lg:col-span-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Needs your attention</p>
          <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
            {loading ? null : (overdueTaskRows.length === 0 && staleClients.length === 0 && oldDrafts === 0 && unsignedContracts === 0) ? (
              <p className="font-serif italic text-lg text-primary">Nothing needs your attention.</p>
            ) : (
              <ul className="space-y-3">
                {overdueTaskRows.map((t) => (
                  <li key={t.id} className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">Overdue: {t.title}</span>
                    {t.client_id && <Link to="/studio/clients/$id" params={{ id: t.client_id }} className="text-xs text-primary hover:underline">Open</Link>}
                  </li>
                ))}
                {oldDrafts > 0 && (
                  <li className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">{oldDrafts} draft{oldDrafts === 1 ? "" : "s"} aging in the queue</span>
                    <Link to="/studio/approval-queue" className="text-xs text-primary hover:underline">Open</Link>
                  </li>
                )}
                {unsignedContracts > 0 && (
                  <li className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">{unsignedContracts} contract{unsignedContracts === 1 ? "" : "s"} unsigned 7+ days</span>
                  </li>
                )}
                {staleClients.map((c) => (
                  <li key={c.id} className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">{c.couple_name_1}{c.couple_name_2 ? " & " + c.couple_name_2 : ""} — last contact {relativeTime(c.last_contacted_at)}</span>
                    <Link to="/studio/clients/$id" params={{ id: c.id }} className="text-xs text-primary hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-10">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">This week</p>
        {weekItems.length === 0 ? (
          <p className="font-serif italic text-base text-muted-foreground">A quiet week ahead.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
            {weekItems.map((it) => (
              <div key={it.id} className="shrink-0 w-[280px] bg-surface rounded-lg shadow-soft p-5">
                <p className="text-xs text-muted-foreground">{it.date}</p>
                <p className="font-serif italic text-lg text-primary mt-1">{it.title}</p>
                <p className={`text-[11px] uppercase tracking-wider mt-2 ${eventColor(it.type)}`}>{it.type}</p>
                <p className="text-sm text-foreground/80 mt-2">{it.subtitle}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KPICard({ label, value, comparison, negative }: { label: string; value: number; comparison: string; negative?: boolean }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold hover:shadow-elevated transition-shadow">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-serif text-[36px] text-primary mt-2 leading-none">{value}</p>
      <p className={`text-xs mt-3 ${negative ? "text-magenta" : "text-sage"}`}>{comparison}</p>
    </div>
  );
}
