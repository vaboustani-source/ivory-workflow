import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { editorialDate, firstName, shortDate, relativeTime } from "@/lib/dates";
import { ChevronRight, AlertCircle, Check } from "lucide-react";

export const Route = createFileRoute("/studio/")({
  component: Dashboard,
});

interface KPIs {
  activeClients: number;
  weddingsThisMonth: number;
  overdueTasks: number;
  galleriesPending: number;
}

interface TaskRow {
  id: string;
  title: string | null;
  client_id: string | null;
  due_date: string | null;
  status: string;
  client?: { couple_name_1: string; couple_name_2: string | null } | null;
}

interface ClientStaleRow {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  last_contacted_at: string | null;
}

interface WeekItem {
  id: string;
  date: string;
  title: string;
  type: "Wedding" | "Engagement" | "Consultation" | "Gallery deadline";
  subtitle: string;
}

function Dashboard() {
  const { profile } = useAuth();
  const [kpis, setKpis] = useState<KPIs>({ activeClients: 0, weddingsThisMonth: 0, overdueTasks: 0, galleriesPending: 0 });
  const [todaysTasks, setTodaysTasks] = useState<TaskRow[]>([]);
  const [staleClients, setStaleClients] = useState<ClientStaleRow[]>([]);
  const [overdueTaskRows, setOverdueTaskRows] = useState<TaskRow[]>([]);
  const [weekItems, setWeekItems] = useState<WeekItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    if (!profile) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndISO = weekEnd.toISOString().slice(0, 10);
    const staleCutoff = new Date(today);
    staleCutoff.setDate(staleCutoff.getDate() - 14);

    const [active, weddings, overdueCount, galleries, todays, stale, overdueRows, upcomingClients, upcomingBookings, upcomingEng] = await Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("clients").select("id", { count: "exact", head: true }).gte("wedding_date", monthStart).lte("wedding_date", monthEnd),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", profile.id).eq("status", "pending").lt("due_date", todayISO),
      supabase.from("galleries").select("id", { count: "exact", head: true }).is("delivered_at", null),
      supabase.from("tasks").select("id, title, client_id, due_date, status, client:clients(couple_name_1, couple_name_2)").eq("assignee_id", profile.id).eq("status", "pending").eq("due_date", todayISO).order("priority", { ascending: false }).limit(3),
      supabase.from("clients").select("id, couple_name_1, couple_name_2, last_contacted_at").in("status", ["active", "booked"]).lt("last_contacted_at", staleCutoff.toISOString()).order("last_contacted_at", { ascending: true }).limit(5),
      supabase.from("tasks").select("id, title, client_id, due_date, status, client:clients(couple_name_1, couple_name_2)").eq("assignee_id", profile.id).eq("status", "pending").lt("due_date", todayISO).order("due_date").limit(5),
      supabase.from("clients").select("id, couple_name_1, couple_name_2, wedding_date, venue_name").gte("wedding_date", todayISO).lte("wedding_date", weekEndISO),
      supabase.from("bookings").select("id, scheduled_at, event_type, client_id, client:clients(couple_name_1, couple_name_2)").gte("scheduled_at", today.toISOString()).lte("scheduled_at", weekEnd.toISOString()),
      supabase.from("engagement_sessions").select("id, scheduled_at, location, client:clients(couple_name_1, couple_name_2)").gte("scheduled_at", today.toISOString()).lte("scheduled_at", weekEnd.toISOString()),
    ]);

    setKpis({
      activeClients: active.count ?? 0,
      weddingsThisMonth: weddings.count ?? 0,
      overdueTasks: overdueCount.count ?? 0,
      galleriesPending: galleries.count ?? 0,
    });
    setTodaysTasks((todays.data ?? []) as TaskRow[]);
    setStaleClients((stale.data ?? []) as ClientStaleRow[]);
    setOverdueTaskRows((overdueRows.data ?? []) as TaskRow[]);

    const items: WeekItem[] = [];
    for (const c of upcomingClients.data ?? []) {
      items.push({
        id: `c-${c.id}`,
        date: shortDate(c.wedding_date),
        title: `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}`,
        type: "Wedding",
        subtitle: c.venue_name ?? "Venue TBD",
      });
    }
    for (const b of upcomingBookings.data ?? []) {
      const client = (b as any).client;
      items.push({
        id: `b-${b.id}`,
        date: shortDate(b.scheduled_at),
        title: client ? `${client.couple_name_1}${client.couple_name_2 ? " & " + client.couple_name_2 : ""}` : "Booking",
        type: "Consultation",
        subtitle: b.event_type?.replace(/_/g, " ") ?? "Call",
      });
    }
    for (const e of upcomingEng.data ?? []) {
      const client = (e as any).client;
      items.push({
        id: `e-${e.id}`,
        date: shortDate(e.scheduled_at),
        title: client ? `${client.couple_name_1}${client.couple_name_2 ? " & " + client.couple_name_2 : ""}` : "Engagement",
        type: "Engagement",
        subtitle: e.location ?? "Location TBD",
      });
    }
    setWeekItems(items.sort((a, b) => a.date.localeCompare(b.date)));
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, [profile?.id]);

  const completeTask = async (id: string) => {
    await supabase.from("tasks").update({ status: "complete", completed_at: new Date().toISOString(), completed_by: profile?.id }).eq("id", id);
    loadAll();
  };

  const eventColor = (t: WeekItem["type"]) => {
    switch (t) {
      case "Wedding": return "text-primary";
      case "Engagement": return "text-sage";
      case "Consultation": return "text-plum";
      case "Gallery deadline": return "text-magenta";
    }
  };

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-serif italic text-[32px] text-primary leading-tight">
          Good morning, {firstName(profile?.full_name)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{editorialDate()}</p>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard label="Active clients" value={kpis.activeClients} comparison="—" />
        <KPICard label="Weddings this month" value={kpis.weddingsThisMonth} comparison="—" />
        <KPICard label="Overdue tasks" value={kpis.overdueTasks} comparison={kpis.overdueTasks > 0 ? "Needs attention" : "All caught up"} negative={kpis.overdueTasks > 0} />
        <KPICard label="Galleries pending" value={kpis.galleriesPending} comparison="—" />
      </div>

      {/* Two-column */}
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
                    <button
                      onClick={() => completeTask(t.id)}
                      className="mt-0.5 h-5 w-5 rounded border-2 border-primary flex items-center justify-center hover:bg-primary/10"
                      aria-label="Complete task"
                    >
                      <Check size={12} className="opacity-0 hover:opacity-100" />
                    </button>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{t.title}</p>
                      {t.client && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.client.couple_name_1}{t.client.couple_name_2 ? " & " + t.client.couple_name_2 : ""}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Needs your attention</p>
          <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
            {loading ? null : staleClients.length === 0 && overdueTaskRows.length === 0 ? (
              <p className="font-serif italic text-lg text-primary">Nothing needs your attention.</p>
            ) : (
              <ul className="space-y-3">
                {overdueTaskRows.map((t) => (
                  <li key={t.id} className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">Overdue: {t.title}</span>
                    <Link to="/studio/clients/$id" params={{ id: t.client_id ?? "" }} className="text-xs text-primary hover:underline">Open</Link>
                  </li>
                ))}
                {staleClients.map((c) => (
                  <li key={c.id} className="border-l-2 border-magenta pl-3 flex items-center gap-3">
                    <AlertCircle size={16} className="text-magenta shrink-0" />
                    <span className="flex-1 text-sm text-foreground">
                      {c.couple_name_1}{c.couple_name_2 ? " & " + c.couple_name_2 : ""} — last contact {relativeTime(c.last_contacted_at)}
                    </span>
                    <Link to="/studio/clients/$id" params={{ id: c.id }} className="text-xs text-primary hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* This week */}
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
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-serif text-[36px] text-primary mt-2 leading-none">{value}</p>
      <p className={`text-xs mt-3 ${negative ? "text-magenta" : "text-sage"}`}>{comparison}</p>
    </div>
  );
}
