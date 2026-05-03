import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, X, Check, Eye, EyeOff, CheckCircle2, Trash2, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

type Role = "subject" | "partner" | "parent" | "step_parent" | "sibling" | "sibling_partner" | "other";
type PersonLike = string | { name: string; role?: Role };
interface SequenceStep {
  order: number;
  label: string;
  people: PersonLike[];
  minutes: number;
  note?: string;
  optional?: "sibling_couples" | "sibling_couples_with_us";
  custom?: boolean;
}

type EditAction = "edited" | "deleted" | "added" | "reordered" | "toggled_optional";
interface EditLogEntry {
  timestamp: string;
  user_id: string | null;
  user_name: string;
  action: EditAction;
  side: "partner_1" | "partner_2" | "combined" | "wedding_party" | "extended";
  step_label: string;
  before?: any;
  after?: any;
}

interface PortraitSequence {
  id: string;
  client_id: string;
  partner_1_sequence: SequenceStep[];
  partner_2_sequence: SequenceStep[];
  combined_sequence: SequenceStep[];
  wedding_party_shots: SequenceStep[];
  extended_shots: SequenceStep[];
  total_minutes: number | null;
  notes: string | null;
  generated_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  couple_review_notes?: string | null;
  couple_edits_log?: EditLogEntry[] | null;
  couple_comments?: string | null;
}

type ListKey = "partner_1_sequence" | "partner_2_sequence" | "combined_sequence" | "wedding_party_shots" | "extended_shots";
const LIST_TO_SIDE: Record<ListKey, EditLogEntry["side"]> = {
  partner_1_sequence: "partner_1",
  partner_2_sequence: "partner_2",
  combined_sequence: "combined",
  wedding_party_shots: "wedding_party",
  extended_shots: "extended",
};

const ROLE_LABEL: Record<Role, string> = {
  subject: "you",
  partner: "partner",
  parent: "parent",
  step_parent: "step-parent",
  sibling: "sibling",
  sibling_partner: "sib partner",
  other: "other",
};

function normPerson(p: PersonLike): { name: string; role?: Role } {
  return typeof p === "string" ? { name: p } : { name: p.name, role: p.role };
}

function renderPeople(people: PersonLike[]): string {
  const arr = people.map(normPerson);
  const counts = new Map<string, number>();
  for (const p of arr) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return arr
    .map((p) => {
      if ((counts.get(p.name) ?? 0) > 1 && p.role) return `${p.name} (${ROLE_LABEL[p.role]})`;
      return p.name;
    })
    .join(", ");
}

export function PortraitSequenceViewer({
  clientId,
  editable = false,
  coupleApproval = false,
  coupleEditable = false,
}: {
  clientId: string;
  editable?: boolean;
  coupleApproval?: boolean;
  coupleEditable?: boolean;
}) {
  const [seq, setSeq] = useState<PortraitSequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState<{ list: ListKey; idx: number } | null>(null);
  const [adding, setAdding] = useState<ListKey | null>(null);
  const [notes, setNotes] = useState("");
  const [coupleComments, setCoupleComments] = useState("");
  const [showSibCouples, setShowSibCouples] = useState(false);
  const [showSibCouplesWithUs, setShowSibCouplesWithUs] = useState(false);
  const [changesOpen, setChangesOpen] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("portrait_sequences").select("*").eq("client_id", clientId).maybeSingle();
    setSeq(data as any);
    setNotes((data as any)?.notes ?? "");
    setCoupleComments((data as any)?.couple_comments ?? "");
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const regenerate = async () => {
    setRegenerating(true);
    const { error } = await supabase.functions.invoke("generate-portrait-sequence", { body: { client_id: clientId } });
    setRegenerating(false);
    if (error) { alert("Couldn't regenerate: " + error.message); return; }
    await load();
  };

  const [approving, setApproving] = useState(false);
  const approve = async () => {
    if (!seq) return;
    setApproving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("portrait_sequences")
      .update({ approved_at: new Date().toISOString(), approved_by: userData?.user?.id ?? null })
      .eq("id", seq.id);
    if (error) { toast.error("Couldn't save approval: " + error.message); setApproving(false); return; }
    supabase.functions.invoke("notify-portrait-approval", { body: { client_id: clientId } }).catch(() => {});
    toast.success("Thanks! Victoria has been notified.");
    setApproving(false);
    await load();
  };

  // Auto-save couple_comments (1s debounce)
  const commentsSaveTimer = useRef<number | null>(null);
  const onCoupleCommentsChange = (val: string) => {
    setCoupleComments(val);
    if (!seq || !coupleEditable) return;
    if (commentsSaveTimer.current) window.clearTimeout(commentsSaveTimer.current);
    commentsSaveTimer.current = window.setTimeout(async () => {
      await supabase.from("portrait_sequences").update({ couple_comments: val } as any).eq("id", seq.id);
    }, 1000);
  };

  const buildLogEntry = async (
    action: EditAction,
    list: ListKey,
    step_label: string,
    before?: any,
    after?: any,
  ): Promise<EditLogEntry> => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;
    let userName = "Couple";
    if (userId) {
      const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
      userName = (prof as any)?.full_name || (prof as any)?.email || userName;
    }
    return {
      timestamp: new Date().toISOString(),
      user_id: userId,
      user_name: userName,
      action,
      side: LIST_TO_SIDE[list],
      step_label,
      before,
      after,
    };
  };

  const updateList = async (
    list: ListKey,
    items: SequenceStep[],
    log?: EditLogEntry,
  ) => {
    if (!seq) return;
    const total = ([
      "partner_1_sequence","partner_2_sequence","combined_sequence","wedding_party_shots","extended_shots",
    ] as ListKey[]).reduce((acc, k) => acc + (k === list ? items : (seq[k] ?? [])).reduce((a, s) => a + (s.minutes ?? 0), 0), 0);
    const patch: any = { [list]: items, total_minutes: total };
    let nextLog = seq.couple_edits_log ?? [];
    if (log) {
      nextLog = [...nextLog, log];
      patch.couple_edits_log = nextLog;
    }
    await supabase.from("portrait_sequences").update(patch).eq("id", seq.id);
    setSeq({ ...seq, [list]: items, total_minutes: total, couple_edits_log: nextLog } as any);
  };

  const visibleTotal = useMemo(() => {
    if (!seq) return 0;
    const lists: SequenceStep[][] = [seq.partner_1_sequence, seq.partner_2_sequence, seq.combined_sequence, seq.wedding_party_shots, seq.extended_shots];
    let t = 0;
    for (const list of lists) for (const s of list ?? []) {
      if (s.optional === "sibling_couples" && !showSibCouples) continue;
      if (s.optional === "sibling_couples_with_us" && !showSibCouplesWithUs) continue;
      t += s.minutes ?? 0;
    }
    return t;
  }, [seq, showSibCouples, showSibCouplesWithUs]);

  if (loading) return <p className="font-serif italic text-primary">Loading sequence…</p>;

  if (!seq) {
    return (
      <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
        <p className="font-serif italic text-2xl text-primary mb-2">No portrait sequence yet.</p>
        <p className="text-sm text-muted-foreground mb-6">
          {editable ? "Will generate automatically when the couple submits Wedding Details & Logistics, or generate manually." : "Once you fill in your Wedding Details & Logistics, we'll build your sequence."}
        </p>
        {editable && (
          <button onClick={regenerate} disabled={regenerating} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 inline-flex items-center gap-2">
            {regenerating && <Loader2 size={14} className="animate-spin" />}
            Generate from questionnaire
          </button>
        )}
      </div>
    );
  }

  const canCoupleEdit = coupleEditable && !editable;
  const canEditAny = editable || canCoupleEdit;
  const editLog = seq.couple_edits_log ?? [];

  const onSaveEdit = async (list: ListKey, idx: number, items: SequenceStep[], updated: SequenceStep) => {
    const before = items[idx];
    const next = items.map((x, i) => (i === idx ? updated : x));
    let log: EditLogEntry | undefined;
    if (canCoupleEdit) {
      log = await buildLogEntry("edited", list, updated.label, { label: before.label }, { label: updated.label });
    }
    await updateList(list, next, log);
    setEditing(null);
  };

  const onDelete = async (list: ListKey, idx: number, items: SequenceStep[]) => {
    const removed = items[idx];
    const next = items.filter((_, i) => i !== idx);
    let log: EditLogEntry | undefined;
    if (canCoupleEdit) {
      log = await buildLogEntry("deleted", list, removed.label, { label: removed.label });
    }
    await updateList(list, next, log);
    setEditing(null);
  };

  const onAdd = async (list: ListKey, items: SequenceStep[], step: SequenceStep) => {
    const flagged: SequenceStep = canCoupleEdit ? { ...step, custom: true } : step;
    const next = [...items, { ...flagged, order: items.length + 1 }];
    let log: EditLogEntry | undefined;
    if (canCoupleEdit) {
      log = await buildLogEntry("added", list, step.label, undefined, { label: step.label });
    }
    await updateList(list, next, log);
    setAdding(null);
  };

  const Section = ({ title, list, items }: { title: string; list: ListKey; items: SequenceStep[] }) => {
    if ((!items || items.length === 0) && adding !== list) return null;
    return (
      <div className="bg-surface rounded-md shadow-soft p-5 border-l-2 border-gold">
        <h3 className="font-serif italic text-xl text-primary mb-3">{title}</h3>
        <ol className="space-y-2">
          {items.map((step, idx) => {
            const faded =
              (step.optional === "sibling_couples" && !showSibCouples) ||
              (step.optional === "sibling_couples_with_us" && !showSibCouplesWithUs);
            const isEditing = editing?.list === list && editing.idx === idx;
            return (
              <li key={idx} className={`flex items-start gap-3 group ${faded ? "opacity-50" : ""}`}>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-6 mt-1">{step.order ?? idx + 1}.</span>
                {isEditing ? (
                  <StepEditor
                    step={step}
                    labelOnly={canCoupleEdit}
                    onSave={(s) => onSaveEdit(list, idx, items, s)}
                    onCancel={() => setEditing(null)}
                    onDelete={() => onDelete(list, idx, items)}
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      {step.label}
                      {step.optional && <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">optional</span>}
                      {step.custom && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-magenta/15 text-magenta">Added by you</span>}
                    </p>
                    {step.people?.length > 0 && (
                      <p className="text-[11px] italic text-muted-foreground">{renderPeople(step.people)}</p>
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{step.minutes} min{step.note ? ` · ${step.note}` : ""}</p>
                  </div>
                )}
                {canEditAny && !isEditing && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => setEditing({ list, idx })} className={`${canCoupleEdit ? "text-primary hover:text-primary/70" : "text-muted-foreground hover:text-primary"}`} aria-label="Edit">
                      <Pencil size={12} />
                    </button>
                    {canCoupleEdit && (
                      <button onClick={() => onDelete(list, idx, items)} className="text-magenta hover:text-magenta/70" aria-label="Delete">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {canEditAny && (
          adding === list ? (
            <div className="mt-3">
              <StepEditor
                step={{ order: items.length + 1, label: "", people: [], minutes: 2 }}
                labelOnly={canCoupleEdit}
                onSave={(s) => onAdd(list, items, s)}
                onCancel={() => setAdding(null)}
                onDelete={() => setAdding(null)}
              />
            </div>
          ) : (
            <button
              onClick={() => setAdding(list)}
              className={`mt-3 border border-dashed px-3 py-1 rounded-md text-xs inline-flex items-center gap-1 ${canCoupleEdit ? "border-primary text-primary hover:bg-primary/10" : "border-gold text-gold hover:bg-gold/10"}`}
            >
              <Plus size={12} /> {canCoupleEdit ? "Add a portrait" : "Add step"}
            </button>
          )
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {editable && editLog.length > 0 && (
        <div className="bg-magenta/5 rounded-md border border-magenta/30 overflow-hidden">
          <button
            onClick={() => setChangesOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-magenta/10"
          >
            <span className="font-serif italic text-base text-primary inline-flex items-center gap-2">
              {changesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Changes from couple ({editLog.length})
            </span>
          </button>
          {changesOpen && (
            <ul className="px-4 pb-4 space-y-1.5">
              {[...editLog].reverse().map((e, i) => (
                <li key={i} className="text-sm text-foreground">
                  <span className="font-medium">{e.user_name}</span>{" "}
                  <span className="text-muted-foreground">
                    {e.action === "deleted" ? "removed" : e.action === "added" ? "added" : e.action === "edited" ? "edited" : e.action}
                  </span>{" "}
                  <span className="italic">"{e.action === "edited" && e.before?.label ? `${e.before.label}" → "${e.after?.label ?? e.step_label}` : e.step_label}"</span>{" "}
                  <span className="text-[11px] text-muted-foreground">on {new Date(e.timestamp).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface rounded-md p-3 border border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Generated {new Date(seq.generated_at).toLocaleString()} · Total ~{visibleTotal} min</span>
          {seq.approved_at ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sage/15 text-sage text-[11px] font-medium">
              <CheckCircle2 size={11} /> Approved {new Date(seq.approved_at).toLocaleDateString()}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/15 text-gold text-[11px] font-medium">Pending review</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSibCouples((v) => !v)}
            className={`px-2 py-1 text-[11px] rounded-md border inline-flex items-center gap-1 ${showSibCouples ? "border-gold text-gold bg-gold/10" : "border-border text-muted-foreground"}`}
            title="Show sibling couple shots"
          >
            {showSibCouples ? <Eye size={11} /> : <EyeOff size={11} />} Sib couples
          </button>
          <button
            onClick={() => setShowSibCouplesWithUs((v) => !v)}
            className={`px-2 py-1 text-[11px] rounded-md border inline-flex items-center gap-1 ${showSibCouplesWithUs ? "border-gold text-gold bg-gold/10" : "border-border text-muted-foreground"}`}
            title="Show 4-person couples shots"
          >
            {showSibCouplesWithUs ? <Eye size={11} /> : <EyeOff size={11} />} Couples (us + sib)
          </button>
          {editable && (
            <button onClick={regenerate} disabled={regenerating} className="border border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10 inline-flex items-center gap-2">
              {regenerating && <Loader2 size={12} className="animate-spin" />}
              Regenerate
            </button>
          )}
        </div>
      </div>

      {editable && seq.notes?.trim() && (
        <div className="bg-gold/5 rounded-md p-4 border-l-2 border-gold">
          <h3 className="font-serif italic text-lg text-primary mb-2">Family Notes</h3>
          <p className="text-sm text-foreground whitespace-pre-wrap">{seq.notes}</p>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-2">Private — not shown to couple</p>
        </div>
      )}

      <Section title="Partner 1 side" list="partner_1_sequence" items={seq.partner_1_sequence ?? []} />
      <Section title="Partner 2 side" list="partner_2_sequence" items={seq.partner_2_sequence ?? []} />
      <Section title="Combined family" list="combined_sequence" items={seq.combined_sequence ?? []} />
      <Section title="Wedding party" list="wedding_party_shots" items={seq.wedding_party_shots ?? []} />
      <Section title="Extended / friend groups" list="extended_shots" items={seq.extended_shots ?? []} />

      {editable && (
        <div className="bg-surface rounded-md p-4 border border-border">
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={async () => { await supabase.from("portrait_sequences").update({ notes }).eq("id", seq.id); }}
            rows={3}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {editable && (seq.couple_comments?.trim() || true) && (
        <div className="bg-surface rounded-md p-4 border-l-2 border-primary">
          <h3 className="font-serif italic text-lg text-primary mb-2 inline-flex items-center gap-2">
            <MessageSquare size={14} /> Notes from couple
          </h3>
          {seq.couple_comments?.trim() ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">{seq.couple_comments}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes from the couple yet.</p>
          )}
        </div>
      )}

      {coupleEditable && (
        <div className="bg-surface rounded-md p-4 border border-border">
          <label className="block text-sm font-medium text-foreground mb-1">Notes for Victoria & Dexter</label>
          <p className="text-xs text-muted-foreground mb-2">
            Anything you want us to know about your family portraits — sensitivities, requests, things to avoid.
          </p>
          <textarea
            value={coupleComments}
            onChange={(e) => onCoupleCommentsChange(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {coupleApproval && (
        seq.approved_at ? (
          <div className="bg-sage/10 border border-sage/30 rounded-md p-6 text-center">
            <CheckCircle2 className="mx-auto text-sage mb-2" size={28} />
            <p className="font-serif italic text-xl text-primary">Approved on {new Date(seq.approved_at).toLocaleDateString()}.</p>
            <p className="text-xs text-muted-foreground mt-1">Thanks! We'll use this on your wedding day. You can still tweak labels or notes anytime.</p>
          </div>
        ) : (
          <div className="bg-surface rounded-md p-6 border-t-2 border-gold text-center">
            <p className="font-serif italic text-lg text-primary mb-3">Does this look right?</p>
            <p className="text-xs text-muted-foreground mb-4">Once approved, we'll lock this in for your wedding day. Message us if anything needs to change.</p>
            <button
              onClick={approve}
              disabled={approving}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 inline-flex items-center gap-2 disabled:opacity-60"
            >
              {approving && <Loader2 size={14} className="animate-spin" />}
              Yes, this looks great
            </button>
          </div>
        )
      )}
    </div>
  );
}

function StepEditor({
  step,
  labelOnly = false,
  onSave,
  onCancel,
  onDelete,
}: {
  step: SequenceStep;
  labelOnly?: boolean;
  onSave: (s: SequenceStep) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(step.label);
  const [minutes, setMinutes] = useState(step.minutes);
  const [people, setPeople] = useState((step.people ?? []).map((p) => (typeof p === "string" ? p : p.name)).join(", "));
  return (
    <div className="flex-1 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" placeholder="Label" />
      {!labelOnly && (
        <input value={people} onChange={(e) => setPeople(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" placeholder="People (comma-separated)" />
      )}
      <div className="flex items-center justify-between gap-2">
        {!labelOnly ? (
          <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="px-2 py-1 border border-border rounded-md text-sm w-20" />
        ) : <span />}
        <div className="flex gap-2">
          <button onClick={onDelete} className="text-xs text-magenta hover:underline">Delete</button>
          <button onClick={onCancel} className="px-2 py-1 text-xs border border-border rounded-md inline-flex items-center gap-1"><X size={12} /> Cancel</button>
          <button
            onClick={() => onSave(
              labelOnly
                ? { ...step, label }
                : { ...step, label, minutes, people: people.split(",").map((s) => ({ name: s.trim() })).filter((p) => p.name) }
            )}
            className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md inline-flex items-center gap-1"
          >
            <Check size={12} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
