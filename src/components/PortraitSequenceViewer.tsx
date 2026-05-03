import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Pencil, X, Check, Eye, EyeOff } from "lucide-react";

type Role = "subject" | "partner" | "parent" | "step_parent" | "sibling" | "sibling_partner" | "other";
type PersonLike = string | { name: string; role?: Role };
interface SequenceStep {
  order: number;
  label: string;
  people: PersonLike[];
  minutes: number;
  note?: string;
  optional?: "sibling_couples" | "sibling_couples_with_us";
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
  approved_at: string | null;
  approved_by: string | null;
}

type ListKey = "partner_1_sequence" | "partner_2_sequence" | "combined_sequence" | "wedding_party_shots" | "extended_shots";

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

export function PortraitSequenceViewer({ clientId, editable = false, coupleView = false }: { clientId: string; editable?: boolean; coupleView?: boolean }) {
  const [seq, setSeq] = useState<PortraitSequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState<{ list: ListKey; idx: number } | null>(null);
  const [notes, setNotes] = useState("");
  const [showSibCouples, setShowSibCouples] = useState(false);
  const [showSibCouplesWithUs, setShowSibCouplesWithUs] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("portrait_sequences").select("*").eq("client_id", clientId).maybeSingle();
    setSeq(data as any);
    setNotes((data as any)?.notes ?? "");
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

  const updateList = async (list: ListKey, items: SequenceStep[]) => {
    if (!seq) return;
    const total = ([
      "partner_1_sequence","partner_2_sequence","combined_sequence","wedding_party_shots","extended_shots",
    ] as ListKey[]).reduce((acc, k) => acc + (k === list ? items : (seq[k] ?? [])).reduce((a, s) => a + (s.minutes ?? 0), 0), 0);
    await supabase.from("portrait_sequences").update({ [list]: items, total_minutes: total } as any).eq("id", seq.id);
    setSeq({ ...seq, [list]: items, total_minutes: total } as any);
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

  const Section = ({ title, list, items }: { title: string; list: ListKey; items: SequenceStep[] }) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="bg-surface rounded-md shadow-soft p-5 border-l-2 border-gold">
        <h3 className="font-serif italic text-xl text-primary mb-3">{title}</h3>
        <ol className="space-y-2">
          {items.map((step, idx) => {
            const faded =
              (step.optional === "sibling_couples" && !showSibCouples) ||
              (step.optional === "sibling_couples_with_us" && !showSibCouplesWithUs);
            return (
            <li key={idx} className={`flex items-start gap-3 group ${faded ? "opacity-50" : ""}`}>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-6 mt-1">{step.order ?? idx + 1}.</span>
              {editing?.list === list && editing.idx === idx ? (
                <StepEditor
                  step={step}
                  onSave={(s) => { updateList(list, items.map((x, i) => i === idx ? s : x)); setEditing(null); }}
                  onCancel={() => setEditing(null)}
                  onDelete={() => { updateList(list, items.filter((_, i) => i !== idx)); setEditing(null); }}
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    {step.label}
                    {step.optional && <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">optional</span>}
                  </p>
                  {step.people?.length > 0 && (
                    <p className="text-[11px] italic text-muted-foreground">{renderPeople(step.people)}</p>
                  )}
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{step.minutes} min{step.note ? ` · ${step.note}` : ""}</p>
                </div>
              )}
              {editable && editing?.idx !== idx && (
                <button onClick={() => setEditing({ list, idx })} className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100" aria-label="Edit">
                  <Pencil size={12} />
                </button>
              )}
            </li>
            );
          })}
        </ol>
        {editable && (
          <button
            onClick={() => updateList(list, [...items, { order: items.length + 1, label: "New step", people: [], minutes: 2 }])}
            className="mt-3 border border-dashed border-gold text-gold px-3 py-1 rounded-md text-xs hover:bg-gold/10 inline-flex items-center gap-1"
          >
            <Plus size={12} /> Add step
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface rounded-md p-3 border border-border">
        <div className="text-xs text-muted-foreground">
          Generated {new Date(seq.generated_at).toLocaleString()} · Total ~{visibleTotal} min
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
    </div>
  );
}

function StepEditor({ step, onSave, onCancel, onDelete }: { step: SequenceStep; onSave: (s: SequenceStep) => void; onCancel: () => void; onDelete: () => void; }) {
  const [label, setLabel] = useState(step.label);
  const [minutes, setMinutes] = useState(step.minutes);
  const [people, setPeople] = useState((step.people ?? []).map((p) => (typeof p === "string" ? p : p.name)).join(", "));
  return (
    <div className="flex-1 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" placeholder="Label" />
      <input value={people} onChange={(e) => setPeople(e.target.value)} className="w-full px-2 py-1 border border-border rounded-md text-sm" placeholder="People (comma-separated)" />
      <div className="flex items-center justify-between gap-2">
        <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="px-2 py-1 border border-border rounded-md text-sm w-20" />
        <div className="flex gap-2">
          <button onClick={onDelete} className="text-xs text-magenta hover:underline">Delete</button>
          <button onClick={onCancel} className="px-2 py-1 text-xs border border-border rounded-md inline-flex items-center gap-1"><X size={12} /> Cancel</button>
          <button onClick={() => onSave({ ...step, label, minutes, people: people.split(",").map((s) => ({ name: s.trim() })).filter((p) => p.name) })} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md inline-flex items-center gap-1"><Check size={12} /> Save</button>
        </div>
      </div>
    </div>
  );
}
