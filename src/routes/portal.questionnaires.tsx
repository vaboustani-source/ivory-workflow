import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
    // Auto-regenerate photography timeline + portrait sequence on logistics submit
    if (questionnaire.template?.name === "Wedding Details & Logistics") {
      const { data: cu } = await supabase
        .from("questionnaires").select("client_id").eq("id", questionnaire.id).maybeSingle();
      if (cu?.client_id) {
        console.log("[auto-regen] firing for client", cu.client_id, "questionnaire", questionnaire.id);
        const calls = [
          supabase.functions.invoke("generate-photography-timeline", {
            body: { client_id: cu.client_id, questionnaire_id: questionnaire.id },
          }),
          supabase.functions.invoke("generate-portrait-sequence", {
            body: { client_id: cu.client_id, questionnaire_id: questionnaire.id },
          }),
        ];
        Promise.allSettled(calls).then((results) => {
          console.log("[auto-regen] results", results);
        });
      } else {
        console.warn("[auto-regen] no client_id resolved for questionnaire", questionnaire.id);
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

  const allRequiredFilled = schema.filter((q) => !NON_QUESTION_TYPES.has(q.type) && q.required && (!q.conditional || responses[q.conditional.on] === q.conditional.equals)).every((q) => isAnswered(q, responses[q.id]));

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
              <SectionProgress schema={schema} responses={responses} />
              <div className="space-y-7">
                {schema.length === 0 ? (
                  <p className="font-serif italic text-muted-foreground">This form has no questions yet.</p>
                ) : (
                  schema
                    .filter((q) => !q.conditional || responses[q.conditional.on] === q.conditional.equals)
                    .map((q) => (
                      <FieldErrorBoundary key={q.id} questionId={q.id} questionType={q.type}>
                        <FieldRow
                          q={q}
                          value={responses[q.id]}
                          error={errors[q.id]}
                          readOnly={isReadOnly}
                          onChange={(v) => setVal(q.id, v)}
                          registerRef={(el) => { if (el) fieldRefs.current.set(q.id, el); else fieldRefs.current.delete(q.id); }}
                        />
                      </FieldErrorBoundary>
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

class FieldErrorBoundary extends Component<{ questionId: string; questionType: string; children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    console.error(`[Questionnaire] field "${this.props.questionId}" (type=${this.props.questionType}) crashed:`, err);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="rounded-md border border-magenta/40 bg-magenta/5 p-3 text-xs text-magenta">
          Couldn't render field <code>{this.props.questionId}</code> (type <code>{this.props.questionType}</code>): {this.state.err.message}
        </div>
      );
    }
    return this.props.children;
  }
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
  if (typeof console !== "undefined") console.debug("[FieldRow] render", q.id, q.type);
  const baseInput = "w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-background-alt disabled:cursor-not-allowed";


  if (q.type === "section_header") {
    return (
      <div ref={registerRef as any} className="pt-4 pb-2 border-b border-gold/40 mt-4">
        <h3 className="font-serif italic text-2xl text-primary">{q.label}</h3>
        {q.helper && <p className="text-sm text-muted-foreground mt-1">{q.helper}</p>}
      </div>
    );
  }

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
      {q.type === "vendor_entry" && (
        <VendorEntryField value={value} readOnly={readOnly} onChange={onChange} />
      )}
      {q.type === "family_portrait_sequence" && (
        <FamilyPortraitField value={value} readOnly={readOnly} onChange={onChange} />
      )}
      {q.type === "wedding_party_shots" && (
        <WeddingPartyField value={value} readOnly={readOnly} onChange={onChange} />
      )}
      {q.type === "extended_portrait_shots" && (
        <ExtendedPortraitField value={value} readOnly={readOnly} onChange={onChange} />
      )}

      {error && <p className="text-[12px] text-magenta">{error}</p>}
    </div>
  );
}

function SectionProgress({ schema, responses }: { schema: QuestionDef[]; responses: Record<string, any> }) {
  const sections: { id: string; label: string; total: number; answered: number }[] = [];
  let cur: { id: string; label: string; items: QuestionDef[] } | null = null;
  for (const q of schema) {
    if (q.type === "section_header") {
      if (cur) sections.push({ id: cur.id, label: cur.label, total: cur.items.length, answered: cur.items.filter((x) => isAnswered(x, responses[x.id])).length });
      cur = { id: q.id, label: q.label, items: [] };
    } else if (cur) {
      if (q.conditional && responses[q.conditional.on] !== q.conditional.equals) continue;
      cur.items.push(q);
    }
  }
  if (cur) sections.push({ id: cur.id, label: cur.label, total: cur.items.length, answered: cur.items.filter((x) => isAnswered(x, responses[x.id])).length });
  if (sections.length === 0) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {sections.map((s) => {
        const done = s.total > 0 && s.answered === s.total;
        const started = s.answered > 0;
        const dotClass = done ? "bg-sage" : started ? "bg-gold" : "bg-muted";
        return (
          <div key={s.id} className="flex items-center gap-1.5 bg-background-alt px-2.5 py-1 rounded-full" title={`${s.answered}/${s.total}`}>
            <span className={`h-2 w-2 rounded-full ${dotClass}`} />
            <span className="text-[11px] text-muted-foreground">{s.answered}/{s.total}</span>
          </div>
        );
      })}
    </div>
  );
}

function VendorEntryField({ value, readOnly, onChange }: { value: any; readOnly: boolean; onChange: (v: any) => void }) {
  const v = value && typeof value === "object" ? value : {};
  const set = (k: string, x: string) => onChange({ ...v, [k]: x });
  const cls = "px-2 py-1.5 border border-border rounded-md text-sm bg-background flex-1 min-w-[150px]";
  return (
    <div className="flex flex-wrap gap-2">
      <input disabled={readOnly} value={v.name ?? ""} placeholder="Business name" onChange={(e) => set("name", e.target.value)} className={cls} />
      <input disabled={readOnly} value={v.instagram ?? ""} placeholder="@instagram" onChange={(e) => set("instagram", e.target.value)} className={cls} />
      <input disabled={readOnly} value={v.contact ?? ""} placeholder="Contact (phone or email)" onChange={(e) => set("contact", e.target.value)} className={cls} />
    </div>
  );
}

interface ParentEntry { name: string; status: "Together" | "Divorced" | "Single parent" | "Deceased" | ""; }
interface SiblingEntry { name: string; has_partner: boolean; partner_name?: string; }
interface FamilyData {
  parents_status?: "Married/together" | "Divorced — friendly" | "Divorced — separate photos" | "Single parent" | "One deceased" | "Both deceased";
  parent_1?: ParentEntry;
  parent_2?: ParentEntry;
  step_parent_1?: string;
  step_parent_2?: string;
  siblings?: SiblingEntry[];
  grandparents?: string;
  notes?: string;
  dynamics_notes?: string;
  include_sibling_couples?: boolean;
  include_sibling_couples_with_us?: boolean;
}
function FamilyPortraitField({ value, readOnly, onChange }: { value: any; readOnly: boolean; onChange: (v: any) => void }) {
  const data: FamilyData = value && typeof value === "object" ? value : {};
  const set = (patch: Partial<FamilyData>) => onChange({ ...data, ...patch });
  const siblings = data.siblings ?? [];
  const setSibling = (i: number, p: Partial<SiblingEntry>) => set({ siblings: siblings.map((s, idx) => idx === i ? { ...s, ...p } : s) });
  const cls = "px-2 py-1.5 border border-border rounded-md text-sm bg-background";
  return (
    <div className="space-y-3 bg-background-alt/40 rounded-md p-4 border border-border">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Parents' situation</label>
        <select disabled={readOnly} value={data.parents_status ?? ""} onChange={(e) => set({ parents_status: e.target.value as any })} className={cls + " w-full"}>
          <option value="">Select…</option>
          <option>Married/together</option>
          <option>Divorced — friendly</option>
          <option>Divorced — separate photos</option>
          <option>Single parent</option>
          <option>One deceased</option>
          <option>Both deceased</option>
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input disabled={readOnly} value={data.parent_1?.name ?? ""} placeholder="Parent 1 name (e.g. Mom)" onChange={(e) => set({ parent_1: { ...(data.parent_1 ?? { status: "" }), name: e.target.value } })} className={cls} />
        <input disabled={readOnly} value={data.parent_2?.name ?? ""} placeholder="Parent 2 name (e.g. Dad)" onChange={(e) => set({ parent_2: { ...(data.parent_2 ?? { status: "" }), name: e.target.value } })} className={cls} />
      </div>
      {(data.parents_status === "Divorced — friendly" || data.parents_status === "Divorced — separate photos") && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input disabled={readOnly} value={data.step_parent_1 ?? ""} placeholder="Step-parent on Parent 1's side (optional)" onChange={(e) => set({ step_parent_1: e.target.value })} className={cls} />
          <input disabled={readOnly} value={data.step_parent_2 ?? ""} placeholder="Step-parent on Parent 2's side (optional)" onChange={(e) => set({ step_parent_2: e.target.value })} className={cls} />
        </div>
      )}
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Siblings</label>
        <div className="space-y-2">
          {siblings.map((s, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <input disabled={readOnly} value={s.name} placeholder="Sibling name" onChange={(e) => setSibling(i, { name: e.target.value })} className={cls + " flex-1 min-w-[140px]"} />
              <label className="flex items-center gap-1 text-xs text-foreground">
                <input type="checkbox" disabled={readOnly} checked={s.has_partner} onChange={(e) => setSibling(i, { has_partner: e.target.checked })} />
                Has partner
              </label>
              {s.has_partner && (
                <input disabled={readOnly} value={s.partner_name ?? ""} placeholder="Partner name" onChange={(e) => setSibling(i, { partner_name: e.target.value })} className={cls + " flex-1 min-w-[140px]"} />
              )}
              {!readOnly && (
                <button type="button" onClick={() => set({ siblings: siblings.filter((_, idx) => idx !== i) })} className="text-magenta text-xs hover:underline">Remove</button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button type="button" onClick={() => set({ siblings: [...siblings, { name: "", has_partner: false }] })} className="border border-dashed border-gold text-gold px-3 py-1 rounded-md text-xs hover:bg-gold/10">
              + Add sibling
            </button>
          )}
        </div>
      </div>
      <input disabled={readOnly} value={data.grandparents ?? ""} placeholder="Grandparents (names, optional)" onChange={(e) => set({ grandparents: e.target.value })} className={cls + " w-full"} />
      <div className="space-y-1.5 pt-1">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" disabled={readOnly} checked={!!data.include_sibling_couples} onChange={(e) => set({ include_sibling_couples: e.target.checked })} />
          Include each sibling + their partner as a separate couple shot
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" disabled={readOnly} checked={!!data.include_sibling_couples_with_us} onChange={(e) => set({ include_sibling_couples_with_us: e.target.checked })} />
          Include couples photos (us + each sibling couple)
        </label>
      </div>
      <textarea disabled={readOnly} value={data.notes ?? ""} placeholder="Anything else we should know about this side?" onChange={(e) => set({ notes: e.target.value })} rows={2} className={cls + " w-full"} />
    </div>
  );
}

function WeddingPartyField({ value, readOnly, onChange }: { value: any; readOnly: boolean; onChange: (v: any) => void }) {
  const data = value && typeof value === "object" ? value : {};
  const set = (patch: any) => onChange({ ...data, ...patch });
  const shots: string[] = Array.isArray(data.shots) ? data.shots : [];
  const cls = "px-2 py-1.5 border border-border rounded-md text-sm bg-background";
  const SHOT_OPTIONS = [
    "Full wedding party together",
    "Each side individually",
    "Couple with each WP member 1:1",
    "Couple with WP side A",
    "Couple with WP side B",
    "Fun/candid group shot",
  ];
  return (
    <div className="space-y-3 bg-background-alt/40 rounded-md p-4 border border-border">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs">
          <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Total party size</span>
          <input type="number" min={0} disabled={readOnly} value={data.party_size ?? ""} onChange={(e) => set({ party_size: e.target.value === "" ? null : Number(e.target.value) })} className={cls + " w-[100px]"} />
        </label>
        <label className="text-xs">
          <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Side A count</span>
          <input type="number" min={0} disabled={readOnly} value={data.side_a_count ?? ""} onChange={(e) => set({ side_a_count: e.target.value === "" ? null : Number(e.target.value) })} className={cls + " w-[100px]"} />
        </label>
        <label className="text-xs">
          <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Side B count</span>
          <input type="number" min={0} disabled={readOnly} value={data.side_b_count ?? ""} onChange={(e) => set({ side_b_count: e.target.value === "" ? null : Number(e.target.value) })} className={cls + " w-[100px]"} />
        </label>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Wedding party shots you want</p>
        <div className="space-y-1">
          {SHOT_OPTIONS.map((opt) => {
            const checked = shots.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={readOnly} checked={checked} onChange={(e) => set({ shots: e.target.checked ? [...shots, opt] : shots.filter((s) => s !== opt) })} />
                {opt}
              </label>
            );
          })}
        </div>
      </div>
      <textarea disabled={readOnly} value={data.notes ?? ""} placeholder="Special requests for the wedding party shots" onChange={(e) => set({ notes: e.target.value })} rows={2} className={cls + " w-full"} />
    </div>
  );
}

function ExtendedPortraitField({ value, readOnly, onChange }: { value: any; readOnly: boolean; onChange: (v: any) => void }) {
  const rows: Array<{ label: string; people: string }> = Array.isArray(value) ? value : [];
  const cls = "px-2 py-1.5 border border-border rounded-md text-sm bg-background";
  const update = (i: number, p: Partial<{ label: string; people: string }>) => onChange(rows.map((r, idx) => idx === i ? { ...r, ...p } : r));
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground italic">No extended shots yet. Add cousins, college friends, etc. below.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center">
          <input disabled={readOnly} value={r.label} placeholder="Group label (e.g. Cousins)" onChange={(e) => update(i, { label: e.target.value })} className={cls + " flex-1 min-w-[160px]"} />
          <input disabled={readOnly} value={r.people} placeholder="People in shot" onChange={(e) => update(i, { people: e.target.value })} className={cls + " flex-[2] min-w-[200px]"} />
          {!readOnly && <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="text-magenta text-xs hover:underline px-2">Remove</button>}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => onChange([...rows, { label: "", people: "" }])} className="border border-dashed border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10">
          + Add extended shot
        </button>
      )}
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
