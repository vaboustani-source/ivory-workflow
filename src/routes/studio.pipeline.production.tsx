import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { shortDate, daysBetween } from "@/lib/dates";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/pipeline/production")({
  component: ProductionPipelinePage,
});

type StageId =
  | "welcome" | "planning" | "engagement" | "pre_wedding" | "wedding_week"
  | "editing" | "delivered" | "album" | "archive";

const COLUMNS: { id: StageId; label: string; emptyText: string }[] = [
  { id: "welcome", label: "WELCOME", emptyText: "No couples in welcome window." },
  { id: "planning", label: "PLANNING", emptyText: "Quiet here." },
  { id: "engagement", label: "ENGAGEMENT", emptyText: "No engagements in flight." },
  { id: "pre_wedding", label: "PRE-WEDDING", emptyText: "Nothing in the home stretch yet." },
  { id: "wedding_week", label: "WEDDING WEEK", emptyText: "No weddings this week." },
  { id: "editing", label: "EDITING", emptyText: "Editing room is clear." },
  { id: "delivered", label: "DELIVERED", emptyText: "Recently delivered will land here." },
  { id: "album", label: "ALBUM", emptyText: "No albums in production." },
  { id: "archive", label: "ARCHIVE", emptyText: "Nothing archived yet." },
];

const STAGE_LABEL: Record<StageId, string> = {
  welcome: "Welcome", planning: "Planning", engagement: "Engagement",
  pre_wedding: "Pre-Wedding", wedding_week: "Wedding Week", editing: "Editing",
  delivered: "Delivered", album: "Album", archive: "Archive",
};

interface Couple {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  status: string;
  booked_at: string | null;
  has_engagement: boolean | null;
  album_workflow_active: boolean | null;
  last_contacted_at: string | null;
  manager_id: string | null;
  production_stage_override: string | null;
  production_stage_override_at: string | null;
  production_stage_override_by: string | null;
  manager?: { full_name: string | null } | null;
  galleries?: { id: string; gallery_type: string | null; delivered_at: string | null }[];
  engagement_sessions?: { id: string; scheduled_at: string | null; delivered_at: string | null }[];
  albums?: { id: string; status: string | null; ordered_at: string | null }[];
  // Computed
  _stage?: StageId;
  _autoStage?: StageId;
  _hasOverdue?: boolean;
  _isStale?: boolean;
  _nextMilestone?: { title: string | null; due_date: string | null } | null;
}

function autoCalcStage(c: Couple, today: Date): StageId {
  const wd = c.wedding_date ? new Date(c.wedding_date + "T00:00:00") : null;
  const eighteenMonthsAgo = new Date(today); eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const hasWeddingGallery = (c.galleries ?? []).some((g) => g.gallery_type === "wedding" && g.delivered_at);
  const eng = (c.engagement_sessions ?? [])[0];
  const album = (c.albums ?? [])[0];

  if (c.status === "archived" || (wd && wd < eighteenMonthsAgo)) return "archive";
  if (c.album_workflow_active && (!album || album.status !== "delivered")) return "album";
  if (hasWeddingGallery) return "delivered";
  if (wd && wd < today && !hasWeddingGallery) return "editing";
  const sevenOut = new Date(today); sevenOut.setDate(sevenOut.getDate() + 7);
  if (wd && wd >= today && wd <= sevenOut) return "wedding_week";
  const fiftySixOut = new Date(today); fiftySixOut.setDate(fiftySixOut.getDate() + 56);
  if (wd && wd >= today && wd <= fiftySixOut) return "pre_wedding";
  if (c.has_engagement && (!eng?.scheduled_at || !eng?.delivered_at) && wd && wd > fiftySixOut) return "engagement";
  if (c.booked_at && new Date(c.booked_at) < new Date(today.getTime() - 30 * 86400000)) return "planning";
  return "welcome";
}

function contextLabel(c: Couple): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const wd = c.wedding_date ? new Date(c.wedding_date + "T00:00:00") : null;
  switch (c._stage) {
    case "welcome": {
      if (!c.booked_at) return "RECENTLY BOOKED";
      const days = Math.max(0, Math.floor((today.getTime() - new Date(c.booked_at).getTime()) / 86400000));
      return `BOOKED ${days} DAY${days === 1 ? "" : "S"} AGO`;
    }
    case "planning": {
      if (!wd) return "PLANNING";
      const months = Math.max(0, Math.round((wd.getTime() - today.getTime()) / (86400000 * 30)));
      return `${months} MONTH${months === 1 ? "" : "S"} UNTIL WEDDING`;
    }
    case "engagement": {
      const eng = (c.engagement_sessions ?? [])[0];
      if (!eng?.scheduled_at) return "ENGAGEMENT UNSCHEDULED";
      const sched = new Date(eng.scheduled_at);
      if (sched > today) {
        const d = Math.ceil((sched.getTime() - today.getTime()) / 86400000);
        return `ENGAGEMENT IN ${d} DAY${d === 1 ? "" : "S"}`;
      }
      return "ENGAGEMENT IN EDITING";
    }
    case "pre_wedding": {
      if (!wd) return "PRE-WEDDING";
      const weeks = Math.max(0, Math.round((wd.getTime() - today.getTime()) / (86400000 * 7)));
      return `${weeks} WEEK${weeks === 1 ? "" : "S"} UNTIL WEDDING`;
    }
    case "wedding_week": {
      if (!wd) return "WEDDING THIS WEEK";
      const day = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][wd.getDay()];
      return `WEDDING ${day}`;
    }
    case "editing": {
      if (!wd) return "EDITING";
      const days = Math.max(0, Math.floor((today.getTime() - wd.getTime()) / 86400000));
      return `${days} DAY${days === 1 ? "" : "S"} POST-WEDDING`;
    }
    case "delivered": {
      const g = (c.galleries ?? []).find((x) => x.gallery_type === "wedding" && x.delivered_at);
      if (!g?.delivered_at) return "DELIVERED";
      const days = Math.max(0, Math.floor((today.getTime() - new Date(g.delivered_at).getTime()) / 86400000));
      return `DELIVERED ${days} DAY${days === 1 ? "" : "S"} AGO`;
    }
    case "album": {
      const album = (c.albums ?? [])[0];
      const map: Record<string, string> = {
        pending_questionnaire: "AWAITING IMAGE SELECTION",
        designing: "DESIGNING",
        proofing: "PROOFING",
        printing: "PRINTING",
        shipped: "SHIPPED",
        delivered: "DELIVERED",
      };
      return map[album?.status ?? ""] ?? "ALBUM IN PROGRESS";
    }
    case "archive": {
      if (!wd) return "ARCHIVED";
      const months = Math.max(0, Math.round((today.getTime() - wd.getTime()) / (86400000 * 30)));
      return `WEDDING ${months} MONTH${months === 1 ? "" : "S"} AGO`;
    }
    default: return "";
  }
}

function ProductionPipelinePage() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const [couples, setCouples] = useState<Couple[]>([]);
  const [confirm, setConfirm] = useState<{ couple: Couple; to: StageId; reason: string } | null>(null);
  const [resetConfirm, setResetConfirm] = useState<Couple | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    const ids = await scopeClientIds();
    let q = supabase
      .from("clients")
      .select(`
        id, couple_name_1, couple_name_2, wedding_date, status, booked_at,
        has_engagement, album_workflow_active, last_contacted_at, manager_id,
        production_stage_override, production_stage_override_at, production_stage_override_by,
        manager:profiles!clients_manager_id_fkey(full_name),
        galleries(id, gallery_type, delivered_at),
        engagement_sessions(id, scheduled_at, delivered_at),
        albums(id, status, ordered_at)
      `)
      .in("status", ["booked", "active", "delivered", "complete", "archived"]);
    if (ids !== null) {
      if (ids.length === 0) { setCouples([]); return; }
      q = q.in("id", ids);
    }
    const { data } = await q;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000);

    const list = ((data ?? []) as unknown as Couple[]).map((c) => {
      const auto = autoCalcStage(c, today);
      const stage = (c.production_stage_override as StageId | null) ?? auto;
      const isStale = c.last_contacted_at ? new Date(c.last_contacted_at) < fourteenDaysAgo : false;
      return { ...c, _stage: stage, _autoStage: auto, _isStale: isStale };
    });

    // Fetch overdue + next milestones in batches
    const clientIds = list.map((c) => c.id);
    if (clientIds.length > 0) {
      const overdue = await supabase
        .from("timeline_milestones")
        .select("client_id")
        .in("client_id", clientIds)
        .eq("status", "upcoming")
        .lt("due_date", todayISO);
      const overdueSet = new Set((overdue.data ?? []).map((r) => r.client_id));

      const upcoming = await supabase
        .from("timeline_milestones")
        .select("client_id, title, due_date")
        .in("client_id", clientIds)
        .eq("status", "upcoming")
        .gte("due_date", todayISO)
        .order("due_date", { ascending: true });
      const nextMap = new Map<string, { title: string | null; due_date: string | null }>();
      (upcoming.data ?? []).forEach((m) => {
        if (!nextMap.has(m.client_id)) nextMap.set(m.client_id, { title: m.title, due_date: m.due_date });
      });

      list.forEach((c) => {
        c._hasOverdue = overdueSet.has(c.id);
        c._nextMilestone = nextMap.get(c.id) ?? null;
      });
    }

    setCouples(list);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const grouped = useMemo(() => {
    const map: Record<StageId, Couple[]> = {
      welcome: [], planning: [], engagement: [], pre_wedding: [], wedding_week: [],
      editing: [], delivered: [], album: [], archive: [],
    };
    couples.forEach((c) => { if (c._stage) map[c._stage].push(c); });
    return map;
  }, [couples]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const id = event.active.id as string;
    const to = event.over.id as StageId;
    const couple = couples.find((c) => c.id === id);
    if (!couple || couple._stage === to) return;
    setConfirm({ couple, to, reason: "" });
  };

  const applyOverride = async () => {
    if (!confirm) return;
    const { couple, to, reason } = confirm;
    await supabase.from("clients").update({
      production_stage_override: to,
      production_stage_override_at: new Date().toISOString(),
      production_stage_override_by: profile?.id ?? null,
    }).eq("id", couple.id);

    const couples_str = `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`;
    await supabase.from("activity_log").insert({
      action_type: "production_stage_overridden",
      target_type: "client",
      target_id: couple.id,
      user_id: profile?.id ?? null,
      description: `Moved ${couples_str} to ${STAGE_LABEL[to]}.${reason ? " Reason: " + reason : ""}`,
      metadata: { from: couple._stage, to, reason: reason || null },
    });

    toast.success(`Moved to ${STAGE_LABEL[to]}.`);
    setConfirm(null);
    load();
  };

  const resetToAuto = async (couple: Couple) => {
    await supabase.from("clients").update({
      production_stage_override: null,
      production_stage_override_at: null,
      production_stage_override_by: null,
    }).eq("id", couple.id);
    await supabase.from("activity_log").insert({
      action_type: "production_stage_overridden",
      target_type: "client",
      target_id: couple.id,
      user_id: profile?.id ?? null,
      description: `Cleared stage override for ${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}.`,
      metadata: { reset: true },
    });
    toast.success("Reset to auto.");
    setResetConfirm(null);
    load();
  };

  return (
    <div>
      <header className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Production Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Where every booked couple stands.</p>
        </div>
        <p className="text-sm text-muted-foreground italic">Auto-calculated. Drag to override.</p>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-6 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <Column key={col.id} id={col.id} label={col.label} count={grouped[col.id].length} emptyText={col.emptyText}>
              {grouped[col.id].map((c) => (
                <CoupleCard key={c.id} couple={c} onReset={() => setResetConfirm(c)} />
              ))}
            </Column>
          ))}
        </div>
      </DndContext>

      {confirm && (
        <OverrideDialog
          confirm={confirm}
          setReason={(r) => setConfirm({ ...confirm, reason: r })}
          onConfirm={applyOverride}
          onCancel={() => setConfirm(null)}
        />
      )}

      {resetConfirm && (
        <ResetDialog
          couple={resetConfirm}
          onConfirm={() => resetToAuto(resetConfirm)}
          onCancel={() => setResetConfirm(null)}
        />
      )}
    </div>
  );
}

function Column({ id, label, count, emptyText, children }: {
  id: StageId; label: string; count: number; emptyText: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 w-[280px] rounded-lg p-3 transition-colors`}
      style={{ background: isOver ? "#EDE3D8" : "#EDE3D8aa" }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[11px] uppercase tracking-wider text-foreground">{label}</p>
        <span className="text-xs text-muted-foreground bg-surface px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-2 min-h-[200px]">
        {count === 0 ? (
          <p className="font-serif italic text-sm text-muted-foreground text-center py-8">{emptyText}</p>
        ) : children}
      </div>
    </div>
  );
}

function CoupleCard({ couple, onReset }: { couple: Couple; onReset: () => void }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: couple.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const couples = `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`;
  const isOverridden = !!couple.production_stage_override;

  const next = couple._nextMilestone;
  let nextChip = "—";
  if (next) {
    const days = daysBetween(next.due_date) ?? 0;
    if (days < 0) nextChip = `Next: ${next.title} ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
    else if (days === 0) nextChip = `Next: ${next.title} today`;
    else nextChip = `Next: ${next.title} in ${days} day${days === 1 ? "" : "s"}`;
  }

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    // Avoid navigating when interacting with the reset button
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    navigate({ to: "/studio/clients/$id", params: { id: couple.id } });
  };

  const borderClass = couple._isStale ? "border border-magenta/60" : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`bg-surface rounded-md shadow-soft p-4 cursor-grab active:cursor-grabbing relative ${borderClass} ${isDragging ? "opacity-40" : ""}`}
    >
      {couple._hasOverdue && (
        <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-magenta" title="Has overdue milestone" />
      )}
      {isOverridden && (
        <span
          className="absolute top-2 right-2 h-2 w-2 rounded-full bg-gold"
          title={`Manual override${couple.production_stage_override_at ? " — set " + shortDate(couple.production_stage_override_at) : ""}`}
        />
      )}

      <p className="font-serif italic text-base text-primary leading-tight pr-4">{couples}</p>
      <p className="text-[13px] text-muted-foreground mt-1">{couple.wedding_date ? shortDate(couple.wedding_date) : "Date TBD"}</p>
      <p className="text-[10px] uppercase tracking-wider text-foreground/70 mt-2">{contextLabel(couple)}</p>

      <div className="flex items-center justify-between mt-3 gap-2">
        <span
          className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px] shrink-0"
          title={couple.manager?.full_name ?? ""}
        >
          {(couple.manager?.full_name ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="text-[11px] text-muted-foreground text-right truncate">{nextChip}</span>
      </div>

      {isOverridden && (
        <button
          data-no-drag
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          Reset to auto
        </button>
      )}
    </div>
  );
}

function OverrideDialog({ confirm, setReason, onConfirm, onCancel }: {
  confirm: { couple: Couple; to: StageId; reason: string };
  setReason: (r: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const couples = `${confirm.couple.couple_name_1}${confirm.couple.couple_name_2 ? " & " + confirm.couple.couple_name_2 : ""}`;
  const auto = confirm.couple._autoStage ?? confirm.couple._stage;
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif italic text-xl text-primary">Move {couples} to {STAGE_LABEL[confirm.to]}?</h3>
        <p className="text-sm text-muted-foreground mt-2">
          This is a manual override. The system would auto-place them in <span className="text-foreground">{STAGE_LABEL[auto as StageId]}</span> based on their current state. Are you sure?
        </p>
        <textarea
          value={confirm.reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you overriding? (logged for the team)"
          className="mt-4 w-full text-sm bg-surface border border-border rounded-md p-2 min-h-[64px] focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="text-sm text-muted-foreground px-3 py-2">Cancel</button>
          <button onClick={onConfirm} className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90">Confirm override</button>
        </div>
      </div>
    </div>
  );
}

function ResetDialog({ couple, onConfirm, onCancel }: {
  couple: Couple; onConfirm: () => void; onCancel: () => void;
}) {
  const couples = `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`;
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif italic text-xl text-primary">Reset {couples}?</h3>
        <p className="text-sm text-muted-foreground mt-2">Clear the override and let the system place them?</p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="text-sm text-muted-foreground px-3 py-2">Cancel</button>
          <button onClick={onConfirm} className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90">Reset</button>
        </div>
      </div>
    </div>
  );
}
