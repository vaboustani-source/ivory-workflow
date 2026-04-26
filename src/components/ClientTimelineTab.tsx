import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { shortDate, relativeTime } from "@/lib/dates";
import { toast } from "sonner";

interface Milestone {
  id: string;
  title: string | null;
  description: string | null;
  due_date: string | null;
  status: string;
  stage: string | null;
  is_client_visible: boolean;
  is_overridden: boolean;
  override_reason: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

const STAGE_ORDER = ["inquiry", "welcome", "engagement", "pre_wedding", "wedding_day", "post_wedding", "album", "long_tail"];

export function ClientTimelineTab({ clientId }: { clientId: string }) {
  const { profile } = useAuth();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClientView, setShowClientView] = useState(false);
  const [selected, setSelected] = useState<Milestone | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("timeline_milestones")
      .select("id, title, description, due_date, status, stage, is_client_visible, is_overridden, override_reason, completed_at, completed_by")
      .eq("client_id", clientId)
      .order("due_date", { ascending: true, nullsFirst: false });
    setMilestones((data ?? []) as Milestone[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const refresh = async () => {
    setRefreshing(true);
    await supabase.rpc("materialize_workflow_for_client", { p_client_id: clientId });
    setRefreshing(false);
    toast.success("Timeline refreshed.");
    load();
  };

  const filtered = showClientView ? milestones.filter((m) => m.is_client_visible) : milestones;
  const grouped = STAGE_ORDER.map((stage) => ({
    stage,
    items: filtered.filter((m) => m.stage === stage),
  })).filter((g) => g.items.length > 0);
  const ungrouped = filtered.filter((m) => !m.stage || !STAGE_ORDER.includes(m.stage));

  const stats = {
    total: filtered.length,
    complete: filtered.filter((m) => m.status === "complete").length,
    upcoming: filtered.filter((m) => m.status === "upcoming").length,
  };

  if (loading) return <p className="font-serif italic text-muted-foreground">Loading timeline…</p>;
  if (filtered.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow-soft py-16 text-center border-t-2 border-gold">
        <p className="font-serif italic text-xl text-primary">No milestones yet.</p>
        <p className="text-sm text-muted-foreground mt-2">Once this client is booked, the workflow will populate the timeline.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-6">
          <Stat label="Total" value={stats.total} />
          <Stat label="Completed" value={stats.complete} icon="✓" />
          <Stat label="Upcoming" value={stats.upcoming} icon="●" />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <input type="checkbox" checked={showClientView} onChange={(e) => setShowClientView(e.target.checked)} />
            Show only what client sees
          </label>
          {profile?.role === "owner" && (
            <button onClick={refresh} disabled={refreshing} className="text-xs text-gold border border-gold rounded-md px-3 py-1.5 hover:bg-gold/10 disabled:opacity-50">
              {refreshing ? "Refreshing…" : "Refresh from template"}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[720px] mx-auto relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-[3px] bg-gold -translate-x-1/2" />
        {grouped.map(({ stage, items }) => (
          <div key={stage} className="mb-8">
            <div className="flex items-center gap-3 mb-6 relative z-10">
              <span className="flex-1 h-px bg-gold/40" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground bg-background px-3">{stage.replace(/_/g, " ")}</span>
              <span className="flex-1 h-px bg-gold/40" />
            </div>
            {items.map((m, idx) => <Node key={m.id} m={m} index={idx} onClick={() => setSelected(m)} />)}
          </div>
        ))}
        {ungrouped.length > 0 && ungrouped.map((m, idx) => <Node key={m.id} m={m} index={idx} onClick={() => setSelected(m)} />)}
      </div>

      {selected && <MilestoneModal m={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg text-foreground mt-1">{icon && <span className="text-sage mr-1">{icon}</span>}{value}</p>
    </div>
  );
}

function Node({ m, index, onClick }: { m: Milestone; index: number; onClick: () => void }) {
  const onRight = index % 2 === 0;
  const dotClass =
    m.status === "complete" ? "bg-sage text-background" :
    m.status === "in_progress" ? "bg-gold" :
    m.status === "skipped" ? "bg-muted-foreground line-through" :
    "bg-background border-2 border-gold";

  return (
    <div className="relative my-4 flex items-center min-h-[60px]">
      {!onRight && (
        <div className="w-1/2 pr-8 flex justify-end">
          <Card m={m} onClick={onClick} />
        </div>
      )}
      {!onRight && <div className="w-1/2" />}
      {onRight && <div className="w-1/2" />}
      {onRight && (
        <div className="w-1/2 pl-8">
          <Card m={m} onClick={onClick} />
        </div>
      )}
      <div className={`absolute left-1/2 -translate-x-1/2 h-6 w-6 rounded-full flex items-center justify-center z-10 ${dotClass}`}>
        {m.status === "complete" && <span className="text-[10px]">✓</span>}
      </div>
    </div>
  );
}

function Card({ m, onClick }: { m: Milestone; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-surface rounded-md shadow-soft p-3 w-[240px] text-left hover:shadow-elevated transition-shadow">
      <p className="text-sm text-foreground">{m.title}</p>
      <p className="text-xs text-muted-foreground mt-1">{m.due_date ? shortDate(m.due_date) : "No date"}</p>
      {m.status === "complete" && m.completed_at && (
        <p className="text-xs text-sage mt-1">Completed {relativeTime(m.completed_at)}</p>
      )}
      {m.is_overridden && (
        <p className="text-[10px] uppercase tracking-wider text-magenta mt-1">● Edited</p>
      )}
    </button>
  );
}

function MilestoneModal({ m, onClose }: { m: Milestone; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-serif italic text-xl text-primary">{m.title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
        </div>
        {m.description && <p className="text-sm text-foreground mb-4">{m.description}</p>}
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Stage</dt><dd className="text-foreground capitalize">{m.stage?.replace(/_/g, " ") ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Due date</dt><dd className="text-foreground">{m.due_date ? shortDate(m.due_date) : "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Status</dt><dd className="text-foreground capitalize">{m.status.replace(/_/g, " ")}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Client visible</dt><dd className="text-foreground">{m.is_client_visible ? "Yes" : "No"}</dd></div>
          {m.is_overridden && (
            <div className="border-t border-border pt-2 mt-2">
              <dt className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Override reason</dt>
              <dd className="text-foreground text-sm">{m.override_reason ?? "—"}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-muted-foreground italic mt-4">Editing milestones ships in Phase 2C.</p>
      </div>
    </div>
  );
}
