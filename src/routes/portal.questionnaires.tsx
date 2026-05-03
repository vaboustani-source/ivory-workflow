import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { shortDate } from "@/lib/dates";
import { toast } from "sonner";
import { X, Check, Loader2, ClipboardList } from "lucide-react";

type SearchSchema = { questionnaire_id?: string };

export const Route = createFileRoute("/portal/questionnaires")({
  validateSearch: (s: Record<string, unknown>): SearchSchema => ({
    questionnaire_id: typeof s.questionnaire_id === "string" ? s.questionnaire_id : undefined,
  }),
  component: () => <PortalGate>{({ clientId }) => <PortalQuestionnaires clientId={clientId} />}</PortalGate>,
});

interface QuestionDef {
  id: string;
  type:
    | "short_text" | "long_text" | "single_select" | "multi_select"
    | "date" | "time" | "email" | "phone" | "file_upload" | "timeline_events"
    | "section_header" | "vendor_entry" | "family_portrait_sequence"
    | "wedding_party_shots" | "extended_portrait_shots";
  label: string;
  helper?: string;
  required?: boolean;
  options?: string[];
  conditional?: { on: string; equals: string };
}

const NON_QUESTION_TYPES = new Set(["section_header"]);
function isAnswered(q: QuestionDef, v: any): boolean {
  if (NON_QUESTION_TYPES.has(q.type)) return true;
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v).some((x) => x !== undefined && x !== null && String(x).trim().length > 0);
  return String(v).trim().length > 0;
}

interface Questionnaire {
  id: string;
  status: string;
  responses: Record<string, any>;
  completed_at: string | null;
  auto_saved_at: string | null;
  locked_after_submit: boolean;
  template: { id: string; name: string | null; description: string | null; schema: any } | null;
}

function PortalQuestionnaires({ clientId }: { clientId: string }) {
  const search = useSearch({ from: "/portal/questionnaires" });
  const navigate = useNavigate();
  const [items, setItems] = useState<Questionnaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Questionnaire | null>(null);
  const [editingCompleted, setEditingCompleted] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("questionnaires")
      .select("id, status, responses, completed_at, auto_saved_at, locked_after_submit, template:questionnaire_templates(id, name, description, schema)")
      .eq("client_id", clientId)
      .order("status", { ascending: true });
    setItems((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  useEffect(() => {
    if (loading) return;
    if (search.questionnaire_id) {
      const q = items.find((x) => x.id === search.questionnaire_id);
      if (q) setOpen(q);
    }
    // eslint-disable-next-line
  }, [loading, search.questionnaire_id]);

  const close = () => {
    setOpen(null);
    setEditingCompleted(false);
    if (search.questionnaire_id) navigate({ to: "/portal/questionnaires", search: {} as any });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">Forms</h1>
        <p className="text-sm text-muted-foreground mt-1">Tell us about your wedding day.</p>
      </header>

      {loading ? (
        <p className="font-serif italic text-primary">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No forms to fill in just yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((q) => (
            <QuestionnaireCard key={q.id} q={q} onOpen={() => setOpen(q)} />
          ))}
        </div>
      )}

      {open && (
        <QuestionnaireModal
          questionnaire={open}
          editingCompleted={editingCompleted}
          onEdit={() => setEditingCompleted(true)}
          onClose={close}
          onSaved={async () => { await load(); }}
          onSubmitted={async () => { await load(); setTimeout(close, 2000); }}
        />
      )}
    </div>
  );
}

function statusTone(s: string) {
  if (s === "complete") return "bg-sage/20 text-sage";
  if (s === "in_progress") return "bg-gold/20 text-gold";
  return "bg-muted text-muted-foreground";
}
function statusLabel(s: string) {
  if (s === "complete") return "Completed";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

function QuestionnaireCard({ q, onOpen }: { q: Questionnaire; onOpen: () => void }) {
  const schema: QuestionDef[] = Array.isArray(q.template?.schema) ? q.template!.schema : [];
  const askable = schema.filter((qd) => !NON_QUESTION_TYPES.has(qd.type));
  const total = askable.length;
  const answered = askable.filter((qd) => isAnswered(qd, q.responses?.[qd.id])).length;

  const cta = q.status === "complete" ? "View responses" : q.status === "in_progress" ? "Continue form" : "Begin form";

  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1">
          <ClipboardList size={16} className="text-gold" />
          <h3 className="font-serif italic text-xl text-primary truncate">{q.template?.name ?? "Form"}</h3>
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${statusTone(q.status)}`}>
            {statusLabel(q.status)}
          </span>
        </div>
        {q.template?.description && (
          <p className="text-[13px] text-muted-foreground">{q.template.description}</p>
        )}
        {q.status === "in_progress" && total > 0 && (
          <div className="mt-3 max-w-[280px]">
            <div className="h-1 bg-background-alt rounded-full overflow-hidden">
              <div className="h-full bg-gold" style={{ width: `${Math.round((answered / total) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{answered} of {total} answered</p>
          </div>
        )}
        {q.status === "complete" && q.completed_at && (
          <p className="text-[11px] text-muted-foreground mt-1">Completed {shortDate(q.completed_at)}</p>
        )}
      </div>
      <button
        onClick={onOpen}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 self-start md:self-auto"
      >
        {cta}
      </button>
    </div>
  );
}

function QuestionnaireModal({
  questionnaire, editingCompleted, onEdit, onClose, onSaved, onSubmitted,
}: {
  questionnaire: Questionnaire;
  editingCompleted: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onSubmitted: () => Promise<void>;
}) {
  const schema: QuestionDef[] = useMemo(
    () => (Array.isArray(questionnaire.template?.schema) ? questionnaire.template!.schema : []),
    [questionnaire]
  );
  const [responses, setResponses] = useState<Record<string, any>>(questionnaire.responses ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(questionnaire.auto_saved_at ? new Date(questionnaire.auto_saved_at) : null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());

  const isReadOnly = questionnaire.status === "complete" && !editingCompleted;
  const lockedComplete = questionnaire.status === "complete" && questionnaire.locked_after_submit;

  // Auto-save
  useEffect(() => {
    if (isReadOnly || done) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveState("saving");
      const payload: any = { responses };
      if (questionnaire.status === "not_started") payload.status = "in_progress";
      payload.auto_saved_at = new Date().toISOString();
      const { error } = await supabase
        .from("questionnaires")
        .update(payload)
        .eq("id", questionnaire.id);
      if (error) { setSaveState("error"); return; }
      setSaveState("saved");
      setSavedAt(new Date());
      setTimeout(() => setSaveState("idle"), 2500);
    }, 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line
  }, [responses]);

  const setVal = (id: string, v: any) => {
    setResponses((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const q of schema) {
      if (NON_QUESTION_TYPES.has(q.type)) continue;
      if (q.conditional && responses[q.conditional.on] !== q.conditional.equals) continue;
      if (!q.required) continue;
      const v = responses[q.id];
      if (!isAnswered(q, v)) next[q.id] = "This field is required.";
      else if (q.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) next[q.id] = "Please enter a valid email.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const firstId = schema.find((q) => next[q.id])?.id;
      if (firstId) {
        const el = fieldRefs.current.get(firstId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("questionnaires")
      .update({
        responses,
        status: "complete",
        completed_at: new Date().toISOString(),
        auto_saved_at: new Date().toISOString(),
      })
      .eq("id", questionnaire.id);
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }
    // Activity log (best-effort; client RLS will block, so soft-fail)
    supabase.from("activity_log").insert({
      action_type: "questionnaire.completed",
      target_type: "questionnaire",
      target_id: questionnaire.id,
      description: `Questionnaire submitted: ${questionnaire.template?.name ?? ""}`,
    }).then(() => {});
    // Auto-regenerate photography timeline if this is the logistics form
    if (questionnaire.template?.name === "Wedding Day Logistics") {
      const { data: cu } = await supabase
        .from("questionnaires").select("client_id").eq("id", questionnaire.id).maybeSingle();
      if (cu?.client_id) {
        supabase.functions.invoke("generate-photography-timeline", {
          body: { client_id: cu.client_id, questionnaire_id: questionnaire.id },
        }).then(() => {});
      }
    }
    setDone(true);
    setSubmitting(false);
    await onSubmitted();
  };

  // ESC + body scroll lock
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const allRequiredFilled = schema.filter((q) => q.required).every((q) => {
    const v = responses[q.id];
    return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim().length > 0);
  });

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full md:max-w-[720px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden"
      >
        <div className="sticky top-0 z-10 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-serif italic text-xl text-primary truncate">
              {isReadOnly ? `Your responses to ${questionnaire.template?.name ?? "this form"}` : (questionnaire.template?.name ?? "Form")}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {!isReadOnly && !done && (
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground hidden sm:inline">
                {saveState === "saving" && "Saving…"}
                {saveState === "saved" && (savedAt ? `Saved ${relTime(savedAt)}` : "Saved")}
                {saveState === "error" && <span className="text-magenta">Save failed</span>}
              </span>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 md:px-10 py-8">
          {done ? (
            <div className="bg-sage/15 rounded-md p-8 text-center">
              <Check size={32} className="text-sage mx-auto mb-3" />
              <p className="font-serif italic text-2xl text-primary">Thank you.</p>
              <p className="text-sm text-muted-foreground mt-2">We'll review your answers.</p>
            </div>
          ) : (
            <>
              {questionnaire.status === "complete" && !editingCompleted && !lockedComplete && (
                <div className="mb-6 flex justify-end">
                  <button onClick={onEdit} className="text-sm text-primary underline hover:text-magenta">
                    Edit responses
                  </button>
                </div>
              )}
              <div className="space-y-7">
                {schema.length === 0 ? (
                  <p className="font-serif italic text-muted-foreground">This form has no questions yet.</p>
                ) : (
                  schema
                    .filter((q) => !q.conditional || responses[q.conditional.on] === q.conditional.equals)
                    .map((q) => (
                      <FieldRow
                        key={q.id}
                        q={q}
                        value={responses[q.id]}
                        error={errors[q.id]}
                        readOnly={isReadOnly}
                        onChange={(v) => setVal(q.id, v)}
                        registerRef={(el) => { if (el) fieldRefs.current.set(q.id, el); else fieldRefs.current.delete(q.id); }}
                      />
                    ))
                )}
              </div>
            </>
          )}
        </div>

        {!isReadOnly && !done && schema.length > 0 && (
          <div className="border-t border-gold/30 bg-surface px-6 md:px-10 py-4 flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground sm:hidden">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved"}
              {saveState === "error" && <span className="text-magenta">Save failed</span>}
            </span>
            <span className="hidden sm:block" />
            <button
              onClick={submit}
              disabled={submitting || !allRequiredFilled}
              className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Submitting…" : "Submit form"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return d.toLocaleTimeString();
}

function FieldRow({
  q, value, error, readOnly, onChange, registerRef,
}: {
  q: QuestionDef;
  value: any;
  error?: string;
  readOnly: boolean;
  onChange: (v: any) => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const baseInput = "w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-background-alt disabled:cursor-not-allowed";

  return (
    <div ref={registerRef as any} className="space-y-2">
      <label className="block text-sm text-foreground">
        {q.label}
        {q.required && <span className="text-magenta ml-1">*</span>}
      </label>
      {q.helper && <p className="text-[12px] text-muted-foreground -mt-1">{q.helper}</p>}

      {q.type === "short_text" && (
        <input type="text" disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={baseInput} />
      )}
      {q.type === "long_text" && (
        <textarea disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={4} className={baseInput} />
      )}
      {q.type === "email" && (
        <input type="email" disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={baseInput} />
      )}
      {q.type === "phone" && (
        <input type="tel" disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={baseInput} />
      )}
      {q.type === "date" && (
        <input type="date" disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={baseInput + " max-w-[220px]"} />
      )}
      {q.type === "time" && (
        <input type="time" disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={baseInput + " max-w-[160px]"} />
      )}
      {q.type === "single_select" && (
        <div className="space-y-1.5">
          {(q.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name={q.id} disabled={readOnly} checked={value === opt} onChange={() => onChange(opt)} />
              <span className="text-sm text-foreground">{opt}</span>
            </label>
          ))}
        </div>
      )}
      {q.type === "multi_select" && (
        <div className="space-y-1.5">
          {(q.options ?? []).map((opt) => {
            const arr: string[] = Array.isArray(value) ? value : [];
            const checked = arr.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, opt]);
                    else onChange(arr.filter((x) => x !== opt));
                  }}
                />
                <span className="text-sm text-foreground">{opt}</span>
              </label>
            );
          })}
        </div>
      )}
      {q.type === "file_upload" && (
        <input type="file" disabled={readOnly} className={baseInput} onChange={(e) => onChange(e.target.files?.[0]?.name ?? null)} />
      )}
      {q.type === "timeline_events" && (
        <TimelineEventsField value={value} readOnly={readOnly} onChange={onChange} />
      )}

      {error && <p className="text-[12px] text-magenta">{error}</p>}
    </div>
  );
}

function TimelineEventsField({ value, readOnly, onChange }: { value: any; readOnly: boolean; onChange: (v: any) => void }) {
  const events: Array<{ time: string; label: string }> = Array.isArray(value) ? value : [];
  const update = (idx: number, patch: Partial<{ time: string; label: string }>) => {
    const next = events.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange(next);
  };
  const remove = (idx: number) => onChange(events.filter((_, i) => i !== idx));
  const add = () => onChange([...events, { time: "", label: "" }]);
  return (
    <div className="space-y-2">
      {events.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No events yet. Add your reception schedule below.</p>
      )}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="time"
            disabled={readOnly}
            value={ev.time ?? ""}
            onChange={(e) => update(i, { time: e.target.value })}
            className="px-2 py-1 border border-border rounded-md text-sm w-[120px] bg-background"
          />
          <input
            type="text"
            disabled={readOnly}
            value={ev.label ?? ""}
            placeholder="e.g. Grand entrance"
            onChange={(e) => update(i, { label: e.target.value })}
            className="flex-1 px-2 py-1 border border-border rounded-md text-sm bg-background"
          />
          {!readOnly && (
            <button type="button" onClick={() => remove(i)} className="text-magenta text-xs hover:underline px-2">Remove</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={add} className="border border-dashed border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10">
          + Add event
        </button>
      )}
    </div>
  );
}
