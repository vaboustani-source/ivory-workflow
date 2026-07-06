import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Plus, Check, X, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { computeGetReadyNotes, to12Hour, type GetReadyKey } from "@/lib/getReadyNotes";

export interface TimelineBlock {
  start: string;
  end: string;
  label: string;
  type: "shoot" | "ceremony" | "travel" | "reception" | "golden_hour" | "buffer";
  notes?: string;
  location?: string;
}

interface PhotographyTimeline {
  id: string;
  client_id: string;
  blocks: TimelineBlock[];
  manual_overrides: Record<string, any>;
  notes_for_photographer: string | null;
  generated_at: string;
  sunset_time: string | null;
  golden_hour_start_time: string | null;
  booked_coverage_hours: number | null;
  generated_coverage_hours: number | null;
  coverage_overage_hours: number | null;
  coverage_status: string | null;
  ceremony_start_time: string | null;
  has_first_look: boolean | null;
  has_wedding_party: boolean | null;
}

const TYPE_PILL: Record<TimelineBlock["type"], string> = {
  shoot: "bg-primary/15 text-primary",
  ceremony: "bg-plum/15 text-plum",
  travel: "bg-muted text-muted-foreground",
  reception: "bg-sage/20 text-sage",
  golden_hour: "bg-gold/25 text-gold",
  buffer: "bg-magenta/15 text-magenta",
};

const TYPE_LABEL: Record<TimelineBlock["type"], string> = {
  shoot: "Shoot",
  ceremony: "Ceremony",
  travel: "Travel",
  reception: "Reception",
  golden_hour: "Golden Hour",
  buffer: "Coverage End",
};

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")}${period}`;
}

function applyOverride(block: TimelineBlock, idx: number, overrides: Record<string, Partial<TimelineBlock>>): TimelineBlock {
  const o = overrides?.[String(idx)];
  return o ? { ...block, ...o } : block;
}

export function TimelineDisplay({ clientId, editable = false }: { clientId: string; editable?: boolean }) {
  const { profile } = useAuth();
  const canEditCheatSheet = editable && (profile?.role === "owner" || profile?.role === "studio_manager");
  const [timeline, setTimeline] = useState<PhotographyTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notes, setNotes] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("photography_timelines")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();
    setTimeline(data as any);
    setNotes((data as any)?.notes_for_photographer ?? "");
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const regenerate = async () => {
    setRegenerating(true);
    const { error } = await supabase.functions.invoke("generate-photography-timeline", {
      body: { client_id: clientId },
    });
    setRegenerating(false);
    if (error) { alert("Couldn't regenerate: " + error.message); return; }
    try {
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        client_id: clientId,
        action_type: "photography_timeline.regenerated",
        target_type: "photography_timeline",
        description: "Photography timeline regenerated",
        client_facing_text: "Your wedding day timeline was updated",
        is_client_visible: true,
      });
    } catch { /* noop */ }
    await load();
  };

  const saveNotes = async () => {
    if (!timeline) return;
    setSavingNotes(true);
    await supabase
      .from("photography_timelines")
      .update({ notes_for_photographer: notes })
      .eq("id", timeline.id);
    setSavingNotes(false);
  };

  const updateBlock = async (idx: number, patch: Partial<TimelineBlock>) => {
    if (!timeline) return;
    const overrides = { ...(timeline.manual_overrides ?? {}), [String(idx)]: { ...(timeline.manual_overrides?.[String(idx)] ?? {}), ...patch } };
    const blocks = timeline.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    await supabase.from("photography_timelines").update({ manual_overrides: overrides as any, blocks: blocks as any }).eq("id", timeline.id);
    setTimeline({ ...timeline, manual_overrides: overrides, blocks });
    setEditingIdx(null);
  };

  const addBlock = async () => {
    if (!timeline) return;
    const last = timeline.blocks[timeline.blocks.length - 1];
    const newBlock: TimelineBlock = {
      start: last?.end ?? "12:00",
      end: last?.end ?? "12:00",
      label: "New block",
      type: "shoot",
    };
    const blocks = [...timeline.blocks, newBlock];
    await supabase.from("photography_timelines").update({ blocks: blocks as any }).eq("id", timeline.id);
    setTimeline({ ...timeline, blocks });
    setEditingIdx(blocks.length - 1);
  };

  const deleteBlock = async (idx: number) => {
    if (!timeline) return;
    const blocks = timeline.blocks.filter((_, i) => i !== idx);
    await supabase.from("photography_timelines").update({ blocks: blocks as any }).eq("id", timeline.id);
    setTimeline({ ...timeline, blocks });
  };

  if (loading) return <p className="font-serif italic text-primary">Loading timeline…</p>;

  if (!timeline) {
    return (
      <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
        <p className="font-serif italic text-2xl text-primary mb-2">No timeline yet.</p>
        <p className="text-sm text-muted-foreground mb-6">
          {editable
            ? "Once the couple submits the Wedding Day Logistics form, the timeline will generate automatically. You can also generate it manually below."
            : "Once you fill in the Wedding Day Logistics form, your timeline will appear here."}
        </p>
        {editable && (
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 inline-flex items-center gap-2"
          >
            {regenerating && <Loader2 size={14} className="animate-spin" />}
            Generate from questionnaire
          </button>
        )}
      </div>
    );
  }

  const blocks = (timeline.blocks ?? [])
    .map((b, i) => applyOverride(b, i, timeline.manual_overrides ?? {}))
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  const booked = timeline.booked_coverage_hours != null ? Number(timeline.booked_coverage_hours) : null;
  const generated = timeline.generated_coverage_hours != null ? Number(timeline.generated_coverage_hours) : null;
  const overage = timeline.coverage_overage_hours != null ? Number(timeline.coverage_overage_hours) : null;
  const exceeds = timeline.coverage_status === "exceeds";

  return (
    <div className="space-y-6">
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface rounded-md p-3 border border-border">
          <div className="text-xs text-muted-foreground">
            Generated {new Date(timeline.generated_at).toLocaleString()}
            {timeline.sunset_time && <> · Sunset {fmtTime(timeline.sunset_time)}</>}
            {timeline.golden_hour_start_time && <> · Golden hour {fmtTime(timeline.golden_hour_start_time)}</>}
            {booked != null && generated != null && (
              <> · Coverage: {booked}hr booked / {generated}hr generated</>
            )}
          </div>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="border border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10 inline-flex items-center gap-2"
          >
            {regenerating && <Loader2 size={12} className="animate-spin" />}
            Regenerate from questionnaire
          </button>
        </div>
      )}

      {exceeds && booked != null && generated != null && overage != null && (
        <div className="bg-magenta/10 border-l-4 border-gold rounded-md p-4">
          <p className="font-serif italic text-lg text-primary">Timeline exceeds booked coverage</p>
          <p className="text-sm text-foreground mt-1">
            Booked {booked}hr / Generated {generated}hr / Recommend offering {overage}hr add-on to capture the full day.
          </p>
        </div>
      )}

      <div className="relative pl-8">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gold/40" />
        {blocks.map((b, idx) => (
          <div key={idx} className="relative mb-4 last:mb-0">
            <span className="absolute -left-[26px] top-3 h-3 w-3 rounded-full bg-gold" />
            <div className="bg-surface rounded-md shadow-soft p-4 border-l-2" style={{ borderLeftColor: borderForType(b.type) }}>
              {editingIdx === idx ? (
                <BlockEditor
                  block={b}
                  onSave={(patch) => updateBlock(idx, patch)}
                  onCancel={() => setEditingIdx(null)}
                  onDelete={() => deleteBlock(idx)}
                />
              ) : (
                <div className="flex flex-col md:flex-row md:items-start md:gap-6">
                  <div className="md:w-[110px] flex-shrink-0 mb-2 md:mb-0">
                    <p className="font-serif italic text-lg text-primary leading-tight">{fmtTime(b.start)}</p>
                    {b.end && b.end !== b.start && (
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">to {fmtTime(b.end)}</p>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`${b.type === "shoot" || b.type === "ceremony" ? "font-serif italic text-lg" : "text-sm font-medium"} text-foreground`}>
                        {b.label}
                      </p>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${TYPE_PILL[b.type]}`}>
                        {TYPE_LABEL[b.type]}
                      </span>
                    </div>
                    {b.location && <p className="text-xs text-muted-foreground mt-0.5">{b.location}</p>}
                    {b.notes && <p className="text-xs text-muted-foreground mt-1 italic">{b.notes}</p>}
                  </div>
                  {editable && (
                    <button onClick={() => setEditingIdx(idx)} className="text-muted-foreground hover:text-primary self-start" aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editable && (
        <button
          onClick={addBlock}
          className="border border-dashed border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 inline-flex items-center gap-2"
        >
          <Plus size={14} /> Add manual block
        </button>
      )}
      <GetReadyCheatSheet
        timeline={timeline}
        editable={canEditCheatSheet}
        coupleView={!editable}
        onOverridesChange={(next) => setTimeline({ ...timeline, manual_overrides: next })}
      />


      {editable && (
        <div className="bg-surface rounded-md p-4 border border-border">
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Notes for photographer</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={3}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Anything the day-of photographer should know…"
          />
          {savingNotes && <p className="text-[11px] text-muted-foreground mt-1">Saving…</p>}
        </div>
      )}
    </div>
  );
}

function borderForType(t: TimelineBlock["type"]): string {
  switch (t) {
    case "shoot": return "var(--primary)";
    case "ceremony": return "var(--plum)";
    case "travel": return "var(--muted-foreground)";
    case "reception": return "var(--sage)";
    case "golden_hour": return "var(--gold)";
    case "buffer": return "var(--magenta)";
  }
}

function BlockEditor({
  block, onSave, onCancel, onDelete,
}: {
  block: TimelineBlock;
  onSave: (patch: Partial<TimelineBlock>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [start, setStart] = useState(block.start);
  const [end, setEnd] = useState(block.end);
  const [label, setLabel] = useState(block.label);
  const [type, setType] = useState<TimelineBlock["type"]>(block.type);
  const [notes, setNotes] = useState(block.notes ?? "");

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1 border border-border rounded-md text-sm w-[110px]" />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1 border border-border rounded-md text-sm w-[110px]" />
        <select value={type} onChange={(e) => setType(e.target.value as TimelineBlock["type"])} className="px-2 py-1 border border-border rounded-md text-sm">
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" placeholder="Label" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" rows={2} placeholder="Notes (optional)" />
      <div className="flex justify-between">
        <button onClick={onDelete} className="text-xs text-magenta hover:underline">Delete</button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1 text-xs border border-border rounded-md inline-flex items-center gap-1"><X size={12} /> Cancel</button>
          <button onClick={() => onSave({ start, end, label, type, notes: notes || undefined })} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md inline-flex items-center gap-1"><Check size={12} /> Save</button>
        </div>
      </div>
    </div>
  );
}
