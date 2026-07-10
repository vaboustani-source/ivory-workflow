import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/dates";
import { X, ClipboardList, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";


interface QuestionDef {
  id: string;
  type: "short_text" | "long_text" | "single_select" | "multi_select" | "date" | "time" | "email" | "phone" | "file_upload";
  label: string;
  helper?: string;
  required?: boolean;
  options?: string[];
}

interface Questionnaire {
  id: string;
  status: string;
  responses: Record<string, any>;
  sent_at: string | null;
  completed_at: string | null;
  auto_saved_at: string | null;
  template: { id: string; name: string | null; description: string | null; schema: any } | null;
}

function statusTone(s: string) {
  if (s === "complete") return "bg-sage/20 text-sage";
  if (s === "in_progress") return "bg-gold/20 text-gold";
  return "bg-muted text-muted-foreground";
}
function statusLabel(s: string) {
  if (s === "complete") return "Complete";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

function countAnswered(q: Questionnaire) {
  const schema: QuestionDef[] = Array.isArray(q.template?.schema) ? q.template!.schema : [];
  const answered = schema.filter((qd) => {
    const v = q.responses?.[qd.id];
    return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
  }).length;
  return { answered, total: schema.length };
}

export function StudioFormsTab({ clientId, openQuestionnaireId }: { clientId: string; openQuestionnaireId?: string }) {
  const { roles } = useAuth();
  const canManage = roles.includes("owner") || roles.includes("studio_manager");
  const [items, setItems] = useState<Questionnaire[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Questionnaire | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingId, setAddingId] = useState<string>("");

  const load = async () => {
    const [{ data: qs }, { data: tmpls }] = await Promise.all([
      supabase
        .from("questionnaires")
        .select("id, status, responses, sent_at, completed_at, auto_saved_at, template:questionnaire_templates(id, name, description, schema)")
        .eq("client_id", clientId)
        .order("status", { ascending: true }),
      supabase.from("questionnaire_templates").select("id, name").eq("is_active", true).order("name"),
    ]);
    setItems((qs ?? []) as any);
    setTemplates((tmpls ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (loading || !openQuestionnaireId) return;
    const q = items.find((x) => x.id === openQuestionnaireId);
    if (q) setOpen(q);
  }, [loading, openQuestionnaireId, items]);

  const assignedTemplateIds = useMemo(() => new Set(items.map((i) => i.template?.id).filter(Boolean) as string[]), [items]);
  const availableTemplates = useMemo(() => templates.filter((t) => !assignedTemplateIds.has(t.id)), [templates, assignedTemplateIds]);

  const handleAdd = async () => {
    if (!addingId) return;
    const { error } = await supabase.from("questionnaires").insert({ client_id: clientId, template_id: addingId, status: "not_started" });
    if (error) { alert(error.message); return; }
    setAdding(false);
    setAddingId("");
    await load();
  };

  const handleRemove = async (q: Questionnaire) => {
    if (!confirm(`Remove "${q.template?.name ?? "this form"}" from this couple?`)) return;
    const { error } = await supabase.from("questionnaires").delete().eq("id", q.id);
    if (error) { alert(error.message); return; }
    await load();
  };

  if (loading) return <p className="font-serif italic text-primary">Loading…</p>;

  const AddControl = canManage ? (
    <div className="flex items-center gap-2">
      {adding ? (
        <>
          <select value={addingId} onChange={(e) => setAddingId(e.target.value)} className="border border-gold/40 rounded-md px-3 py-2 text-sm bg-surface">
            <option value="">Select a form…</option>
            {availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name ?? "Untitled"}</option>)}
          </select>
          <button onClick={handleAdd} disabled={!addingId} className="bg-gold text-plum px-4 py-2 rounded-md text-sm disabled:opacity-50">Assign</button>
          <button onClick={() => { setAdding(false); setAddingId(""); }} className="text-muted-foreground text-sm">Cancel</button>
        </>
      ) : (
        <button onClick={() => setAdding(true)} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 flex items-center gap-2">
          <Plus size={14} /> Add form
        </button>
      )}
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        {canManage && <div className="flex justify-end">{AddControl}</div>}
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No forms yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canManage && <div className="flex justify-end">{AddControl}</div>}
      {items.map((q) => {
        const { answered, total } = countAnswered(q);
        const sub = q.status === "complete" && q.completed_at ? `Submitted ${shortDate(q.completed_at)}`
          : q.status === "in_progress" && q.sent_at ? `Started ${shortDate(q.sent_at)}`
          : q.status === "not_started" && q.sent_at ? `Sent ${shortDate(q.sent_at)} · Awaiting response`
          : "Awaiting response";
        return (
          <div key={q.id} className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-1">
                <ClipboardList size={16} className="text-gold" />
                <h3 className="font-serif italic text-xl text-primary truncate">{q.template?.name ?? "Form"}</h3>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${statusTone(q.status)}`}>{statusLabel(q.status)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{sub}</p>
              {total > 0 && q.status !== "not_started" && (
                <p className="text-sm text-foreground mt-1">{answered} of {total} answered</p>
              )}
            </div>
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button onClick={() => setOpen(q)} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10">View responses</button>
              {canManage && q.status !== "complete" && (
                <button onClick={() => handleRemove(q)} className="text-muted-foreground hover:text-magenta p-2" title="Remove form"><Trash2 size={16} /></button>
              )}
            </div>
          </div>
        );
      })}

      {open && <ResponsesModal questionnaire={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ResponsesModal({ questionnaire, onClose }: { questionnaire: Questionnaire; onClose: () => void }) {
  const schema: QuestionDef[] = Array.isArray(questionnaire.template?.schema) ? questionnaire.template!.schema : [];


  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[720px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary truncate pr-4">{questionnaire.template?.name ?? "Form"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 md:px-10 py-8 space-y-7">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
            <span>Status: <span className="text-foreground capitalize">{statusLabel(questionnaire.status)}</span></span>
            {questionnaire.completed_at && <span>Submitted {new Date(questionnaire.completed_at).toLocaleString()}</span>}
            {questionnaire.auto_saved_at && !questionnaire.completed_at && <span>Last saved {new Date(questionnaire.auto_saved_at).toLocaleString()}</span>}
          </div>

          {schema.length === 0 ? (
            <p className="font-serif italic text-muted-foreground">This form has no questions yet.</p>
          ) : (
            schema.map((q) => {
              const v = questionnaire.responses?.[q.id];
              const empty = v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim?.().length === 0);
              return (
                <div key={q.id} className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{q.label}</p>
                  {empty ? (
                    <p className="font-serif italic text-muted-foreground">— Not yet answered</p>
                  ) : Array.isArray(v) ? (
                    <p className="text-sm text-foreground">{v.join(", ")}</p>
                  ) : q.type === "long_text" ? (
                    <p className="text-sm text-foreground whitespace-pre-wrap">{String(v)}</p>
                  ) : q.type === "date" ? (
                    <p className="text-sm text-foreground">{shortDate(String(v))}</p>
                  ) : (
                    <p className="text-sm text-foreground">{String(v)}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
