import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronRight, Plus, Search, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope, useViewAs } from "@/lib/view-as";
import { shortDate, relativeTime, parseDateFlexible } from "@/lib/dates";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/tasks")({
  component: TasksPage,
});

interface TaskRow {
  id: string;
  title: string | null;
  description: string | null;
  client_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  auto_generated: boolean | null;
  client?: { couple_name_1: string; couple_name_2: string | null } | null;
  assignee?: { full_name: string | null } | null;
}

interface ClientLite { id: string; couple_name_1: string; couple_name_2: string | null; }
interface ProfileLite { id: string; full_name: string | null; }

type ViewMode = "mine" | "all";
type PriorityFilter = "all" | "high" | "normal" | "low";
type AutoGenFilter = "both" | "auto" | "manual";

function TasksPage() {
  const { profile } = useAuth();
  const { effectiveUserId, effectiveRole, isRealOwner } = useViewAs();
  const { scopeClientIds } = useEffectiveScope();
  const [view, setView] = useState<ViewMode>("mine");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [team, setTeam] = useState<ProfileLite[]>([]);
  const [search, setSearch] = useState("");
  const [coupleFilter, setCoupleFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [autoGenFilter, setAutoGenFilter] = useState<AutoGenFilter>("both");
  const [showAllLater, setShowAllLater] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const canSeeAll = isRealOwner || effectiveRole === "owner" || effectiveRole === "studio_manager";

  const load = async () => {
    if (!effectiveUserId) return;
    const ids = await scopeClientIds();
    let q = supabase
      .from("tasks")
      .select("id, title, description, client_id, assignee_id, due_date, priority, status, auto_generated, client:clients(couple_name_1, couple_name_2), assignee:profiles!tasks_assignee_id_fkey(full_name)")
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false });

    if (view === "mine") {
      q = q.eq("assignee_id", effectiveUserId);
    } else if (ids !== null) {
      // All tasks but scoped (manager view)
      if (ids.length === 0) q = q.eq("id", "00000000-0000-0000-0000-000000000000");
      else q = q.or(`client_id.in.(${ids.join(",")}),client_id.is.null`);
    }
    const { data } = await q;
    setTasks((data ?? []) as unknown as TaskRow[]);
  };

  useEffect(() => {
    load();
    supabase.from("clients").select("id, couple_name_1, couple_name_2").order("couple_name_1").then(({ data }) => setClients(data ?? []));
    supabase.from("profiles").select("id, full_name").in("role", ["owner", "studio_manager", "associate_photographer"]).then(({ data }) => setTeam(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, effectiveUserId]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (autoGenFilter === "auto" && !t.auto_generated) return false;
      if (autoGenFilter === "manual" && t.auto_generated) return false;
      if (coupleFilter !== "all" && t.client_id !== coupleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.title?.toLowerCase().includes(q) && !t.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, priorityFilter, autoGenFilter, coupleFilter, search]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const weekEnd = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 7); return d; }, [today]);

  const grouped = useMemo(() => {
    const overdue: TaskRow[] = [];
    const todayList: TaskRow[] = [];
    const week: TaskRow[] = [];
    const later: TaskRow[] = [];
    filtered.forEach((t) => {
      if (!t.due_date) { later.push(t); return; }
      const d = new Date(t.due_date); d.setHours(0, 0, 0, 0);
      if (d < today) overdue.push(t);
      else if (d.getTime() === today.getTime()) todayList.push(t);
      else if (d <= weekEnd) week.push(t);
      else later.push(t);
    });
    return { overdue, today: todayList, week, later };
  }, [filtered, today, weekEnd]);

  const completeTask = async (id: string) => {
    setCompleting((s) => new Set(s).add(id));
    await supabase.from("tasks").update({
      status: "complete",
      completed_at: new Date().toISOString(),
      completed_by: profile?.id,
    }).eq("id", id);
    await supabase.from("activity_log").insert({
      user_id: profile?.id,
      action_type: "task_completed",
      target_type: "task",
      target_id: id,
      description: `Completed task`,
    });
    setTimeout(() => {
      setTasks((ts) => ts.filter((t) => t.id !== id));
      setCompleting((s) => { const n = new Set(s); n.delete(id); return n; });
    }, 600);
  };

  return (
    <div>
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">What needs doing.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 flex items-center gap-2">
          <Plus size={16} /> New Task
        </button>
      </header>

      {canSeeAll && (
        <div className="flex gap-1.5 mb-5">
          {(["mine", "all"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-full text-xs ${
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
              }`}
            >
              {v === "mine" ? "My Tasks" : "All Tasks"}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="relative w-[320px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <select value={coupleFilter} onChange={(e) => setCoupleFilter(e.target.value)} className="bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <option value="all">All couples</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.couple_name_1}{c.couple_name_2 ? " & " + c.couple_name_2 : ""}</option>)}
        </select>
        <div className="flex gap-1">
          {(["all", "high", "normal", "low"] as PriorityFilter[]).map((p) => (
            <button key={p} onClick={() => setPriorityFilter(p)} className={`px-3 py-1.5 rounded-full text-xs capitalize ${
              priorityFilter === p ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground"
            }`}>{p}</button>
          ))}
        </div>
        <select value={autoGenFilter} onChange={(e) => setAutoGenFilter(e.target.value as AutoGenFilter)} className="bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <option value="both">Both</option>
          <option value="auto">Auto-generated only</option>
          <option value="manual">Manual only</option>
        </select>
      </div>

      <div className="space-y-8">
        {grouped.overdue.length > 0 && (
          <Section title="OVERDUE" count={grouped.overdue.length}>
            {grouped.overdue.map((t) => <TaskRow key={t.id} t={t} onComplete={completeTask} completing={completing.has(t.id)} accent="magenta" overdue />)}
          </Section>
        )}
        <Section title="DUE TODAY" count={grouped.today.length} emptyText="Nothing due today.">
          {grouped.today.map((t) => <TaskRow key={t.id} t={t} onComplete={completeTask} completing={completing.has(t.id)} accent="gold" />)}
        </Section>
        <Section title="THIS WEEK" count={grouped.week.length} emptyText="Quiet week ahead.">
          {grouped.week.map((t) => <TaskRow key={t.id} t={t} onComplete={completeTask} completing={completing.has(t.id)} />)}
        </Section>
        <Section title="LATER" count={grouped.later.length} emptyText="—">
          {grouped.later.slice(0, showAllLater ? undefined : 20).map((t) => <TaskRow key={t.id} t={t} onComplete={completeTask} completing={completing.has(t.id)} />)}
          {grouped.later.length > 20 && !showAllLater && (
            <button onClick={() => setShowAllLater(true)} className="text-xs text-primary hover:underline">Show all ({grouped.later.length - 20} more)</button>
          )}
        </Section>
      </div>

      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={load}
        clients={clients}
        team={team}
        currentUserId={profile?.id ?? null}
      />
    </div>
  );
}

function Section({ title, count, emptyText, children }: { title: string; count: number; emptyText?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-wider text-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">{count} task{count === 1 ? "" : "s"}</span>
      </div>
      {count === 0 && emptyText ? (
        <p className="font-serif italic text-base text-muted-foreground py-4">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function TaskRow({ t, onComplete, completing, accent, overdue }: {
  t: TaskRow; onComplete: (id: string) => void; completing: boolean; accent?: "magenta" | "gold"; overdue?: boolean;
}) {
  const borderClass = accent === "magenta" ? "border-l-2 border-magenta" : accent === "gold" ? "border-l-2 border-gold" : "";
  const couple = t.client ? `${t.client.couple_name_1}${t.client.couple_name_2 ? " & " + t.client.couple_name_2 : ""}` : null;
  return (
    <div className={`bg-surface rounded-sm shadow-soft p-4 flex items-center gap-3 ${borderClass} ${completing ? "opacity-40 line-through" : ""} transition-opacity`}>
      <button
        onClick={() => onComplete(t.id)}
        disabled={completing}
        className="h-5 w-5 rounded border-2 border-primary flex items-center justify-center hover:bg-primary/10 shrink-0"
        aria-label="Complete task"
      >
        {completing && <Check size={12} className="text-primary" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{t.title}</p>
        {couple && <p className="font-serif italic text-[13px] text-muted-foreground truncate">{couple}</p>}
      </div>
      {t.due_date && (
        <span className={`text-xs shrink-0 ${overdue ? "text-magenta" : "text-muted-foreground"}`}>{relativeTime(t.due_date)}</span>
      )}
      {t.assignee?.full_name && (
        <span className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px] shrink-0" title={t.assignee.full_name}>
          {t.assignee.full_name.charAt(0).toUpperCase()}
        </span>
      )}
      {t.client_id ? (
        <Link to="/studio/clients/$id" params={{ id: t.client_id }} className="text-muted-foreground hover:text-primary shrink-0">
          <ChevronRight size={16} />
        </Link>
      ) : <span className="w-4 shrink-0" />}
    </div>
  );
}

function NewTaskModal({ open, onClose, onCreated, clients, team, currentUserId }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  clients: ClientLite[]; team: ProfileLite[]; currentUserId: string | null;
}) {
  const [form, setForm] = useState({
    title: "", description: "", client_id: "", assignee_id: currentUserId ?? "",
    due_date: "", priority: "normal" as "low" | "normal" | "high",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (currentUserId) setForm((f) => ({ ...f, assignee_id: f.assignee_id || currentUserId })); }, [currentUserId]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from("tasks").insert({
      title: form.title,
      description: form.description || null,
      client_id: form.client_id || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date,
      priority: form.priority,
      status: "pending",
      auto_generated: false,
    }).select("id").single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_log").insert({
      user_id: currentUserId,
      action_type: "task_created",
      target_type: "task",
      target_id: data.id,
      description: `Created task: ${form.title}`,
    });
    toast.success("Task added.");
    onCreated();
    onClose();
    setForm({ title: "", description: "", client_id: "", assignee_id: currentUserId ?? "", due_date: "", priority: "normal" });
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <h2 className="font-serif italic text-2xl text-primary">New task</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <Select label="Client" value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })}>
            <option value="">— Studio-wide —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.couple_name_1}{c.couple_name_2 ? " & " + c.couple_name_2 : ""}</option>)}
          </Select>
          <Select label="Assignee" value={form.assignee_id} onChange={(v) => setForm({ ...form, assignee_id: v })}>
            {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </Select>
          <Field label="Due date" type="date" required value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
          <Select label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v as "low" | "normal" | "high" })}>
            {["low", "normal", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <div className="flex justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-primary px-3 py-2">Cancel</button>
            <button type="submit" disabled={busy} className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {busy ? "Adding…" : "Add task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}{required && " *"}</label>
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 capitalize">
        {children}
      </select>
    </div>
  );
}

// shortDate import retained for potential future use
void shortDate;
