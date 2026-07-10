import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/dates";
import { X, ClipboardList, Plus, Trash2, Eye, Pencil, ExternalLink, Copy, Mail, Download, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { sendFormLink } from "@/lib/send-form-link.functions";
import { FieldRow, type QuestionDef } from "@/routes/portal.questionnaires";

interface Questionnaire {
  id: string;
  status: string;
  responses: Record<string, any>;
  sent_at: string | null;
  completed_at: string | null;
  auto_saved_at: string | null;
  locked_after_submit?: boolean | null;
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

function formUrl(q: Questionnaire) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/portal/questionnaires?questionnaire_id=${q.id}`;
}

export function StudioFormsTab({ clientId, openQuestionnaireId }: { clientId: string; openQuestionnaireId?: string }) {
  const { roles } = useAuth();
  const canManage = roles.includes("owner") || roles.includes("studio_manager");
  const [items, setItems] = useState<Questionnaire[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Questionnaire | null>(null);
  const [openMode, setOpenMode] = useState<"view" | "edit">("view");
  const [adding, setAdding] = useState(false);
  const [addingId, setAddingId] = useState<string>("");
  const [coupleNames, setCoupleNames] = useState<string>("");
  const sendFormLinkFn = useServerFn(sendFormLink);

  const load = async () => {
    const [{ data: qs }, { data: tmpls }, { data: client }] = await Promise.all([
      supabase
        .from("questionnaires")
        .select("id, status, responses, sent_at, completed_at, auto_saved_at, locked_after_submit, template:questionnaire_templates(id, name, description, schema)")
        .eq("client_id", clientId)
        .order("status", { ascending: true }),
      supabase.from("questionnaire_templates").select("id, name").eq("is_active", true).order("name"),
      supabase.from("clients").select("couple_name_1, couple_name_2").eq("id", clientId).maybeSingle(),
    ]);
    setItems((qs ?? []) as any);
    setTemplates((tmpls ?? []) as any);
    if (client) {
      setCoupleNames(
        (client.couple_name_1 ?? "") + (client.couple_name_2 ? ` & ${client.couple_name_2}` : ""),
      );
    }
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
    if (q) { setOpen(q); setOpenMode("view"); }
  }, [loading, openQuestionnaireId, items]);

  const assignedTemplateIds = useMemo(() => new Set(items.map((i) => i.template?.id).filter(Boolean) as string[]), [items]);
  const availableTemplates = useMemo(() => templates.filter((t) => !assignedTemplateIds.has(t.id)), [templates, assignedTemplateIds]);

  const handleAdd = async () => {
    if (!addingId) return;
    const { error } = await supabase.from("questionnaires").insert({ client_id: clientId, template_id: addingId, status: "not_started" });
    if (error) { toast.error(error.message); return; }
    setAdding(false);
    setAddingId("");
    await load();
  };

  const handleRemove = async (q: Questionnaire) => {
    if (!confirm(`Remove "${q.template?.name ?? "this form"}" from this couple?`)) return;
    const { error } = await supabase.from("questionnaires").delete().eq("id", q.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const handleCopy = async (q: Questionnaire) => {
    const url = formUrl(q);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const handleOpenNewTab = (q: Questionnaire) => {
    window.open(formUrl(q), "_blank", "noopener,noreferrer");
  };

  const handleSendEmail = async (q: Questionnaire) => {
    const toastId = toast.loading("Sending form link…");
    try {
      const res = await sendFormLinkFn({ data: { questionnaire_id: q.id } });
      if (res.ok) {
        toast.success(res.status === "test_mode_blocked" ? "Send queued (test mode)" : "Email sent", { id: toastId });
      } else {
        toast.error(res.error ?? "Send failed", { id: toastId });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed", { id: toastId });
    }
  };

  const handleDownload = (q: Questionnaire) => {
    printQuestionnaire(q, coupleNames);
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
            <div className="flex items-center gap-1 self-start md:self-auto flex-wrap">
              <IconBtn title="View" onClick={() => { setOpen(q); setOpenMode("view"); }}><Eye size={15} /></IconBtn>
              {canManage && (
                <IconBtn title="Edit responses" onClick={() => { setOpen(q); setOpenMode("edit"); }}><Pencil size={15} /></IconBtn>
              )}
              <IconBtn title="Open in new tab" onClick={() => handleOpenNewTab(q)}><ExternalLink size={15} /></IconBtn>
              <IconBtn title="Copy link" onClick={() => handleCopy(q)}><Copy size={15} /></IconBtn>
              {canManage && (
                <IconBtn title="Send via email" onClick={() => handleSendEmail(q)}><Mail size={15} /></IconBtn>
              )}
              <IconBtn title="Download PDF" onClick={() => handleDownload(q)}><Download size={15} /></IconBtn>
              {canManage && q.status !== "complete" && (
                <IconBtn title="Remove form" onClick={() => handleRemove(q)} danger><Trash2 size={15} /></IconBtn>
              )}
            </div>
          </div>
        );
      })}

      {open && (
        <ResponsesModal
          questionnaire={open}
          mode={openMode}
          canEdit={canManage}
          onClose={() => setOpen(null)}
          onSaved={async () => { await load(); }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-2 rounded-md border border-gold/40 hover:bg-gold/10 ${danger ? "text-muted-foreground hover:text-magenta" : "text-primary"}`}
    >
      {children}
    </button>
  );
}

function ResponsesModal({
  questionnaire, mode, canEdit, onClose, onSaved,
}: {
  questionnaire: Questionnaire;
  mode: "view" | "edit";
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const schema: QuestionDef[] = Array.isArray(questionnaire.template?.schema) ? questionnaire.template!.schema : [];
  const [editing, setEditing] = useState(mode === "edit");
  const [responses, setResponses] = useState<Record<string, any>>(questionnaire.responses ?? {});
  const [saving, setSaving] = useState(false);
  const fieldRefs = useRef(new Map<string, HTMLElement | null>());
  const registerRef = (id: string) => (el: HTMLElement | null) => { fieldRefs.current.set(id, el); };

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const readOnly = !editing;
  const isLocked = questionnaire.locked_after_submit && questionnaire.status === "complete";

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("questionnaires")
      .update({ responses, auto_saved_at: new Date().toISOString() })
      .eq("id", questionnaire.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Responses saved");
    await onSaved();
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[720px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between gap-3 z-10">
          <h2 className="font-serif italic text-xl text-primary truncate pr-4">{questionnaire.template?.name ?? "Form"}</h2>
          <div className="flex items-center gap-2">
            {canEdit && !editing && (
              <button onClick={() => setEditing(true)} className="text-sm border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10 flex items-center gap-1.5">
                <Pencil size={14} /> Edit
              </button>
            )}
            {editing && (
              <>
                <button onClick={save} disabled={saving} className="text-sm bg-gold text-plum px-3 py-1.5 rounded-md disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setResponses(questionnaire.responses ?? {}); setEditing(false); }} className="text-sm text-muted-foreground">Cancel</button>
              </>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 md:px-10 py-8 space-y-6">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
            <span>Status: <span className="text-foreground">{statusLabel(questionnaire.status)}</span></span>
            {questionnaire.completed_at && <span>Submitted {new Date(questionnaire.completed_at).toLocaleString()}</span>}
            {questionnaire.auto_saved_at && !questionnaire.completed_at && <span>Last saved {new Date(questionnaire.auto_saved_at).toLocaleString()}</span>}
          </div>
          {isLocked && editing && (
            <div className="text-xs bg-gold/10 border border-gold/30 rounded-md px-3 py-2 text-primary">
              This form is normally locked after submission. Studio override active — your edits will overwrite the couple's responses.
            </div>
          )}

          {schema.length === 0 ? (
            <p className="font-serif italic text-muted-foreground">This form has no questions yet.</p>
          ) : (
            schema.map((q) => (
              <FieldRow
                key={q.id}
                q={q}
                value={responses[q.id]}
                readOnly={readOnly}
                onChange={(v) => setResponses((prev) => ({ ...prev, [q.id]: v }))}
                registerRef={registerRef(q.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---- PDF via print window ----
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function renderAnswerHtml(q: QuestionDef, v: any): string {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && v.trim().length === 0)) {
    return `<em style="color:#888">Not yet answered</em>`;
  }
  if (Array.isArray(v)) return escapeHtml(v.join(", "));
  if (typeof v === "object") return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(JSON.stringify(v, null, 2))}</pre>`;
  if (q.type === "long_text") return `<div style="white-space:pre-wrap">${escapeHtml(String(v))}</div>`;
  return escapeHtml(String(v));
}
function printQuestionnaire(q: Questionnaire, coupleNames: string) {
  const schema: QuestionDef[] = Array.isArray(q.template?.schema) ? q.template!.schema : [];
  const title = q.template?.name ?? "Form";
  const w = window.open("", "_blank");
  if (!w) { toast.error("Popup blocked — allow popups to download"); return; }
  const body = schema.map((qd) => {
    if (qd.type === "section_header") {
      return `<h2 style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#3a2a1a;border-bottom:1px solid #d4b878;padding-bottom:6px;margin-top:28px">${escapeHtml(qd.label)}</h2>`;
    }
    return `
      <div style="margin:16px 0;page-break-inside:avoid">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#666;margin-bottom:4px">${escapeHtml(qd.label)}</div>
        <div style="font-size:14px;color:#222;line-height:1.6">${renderAnswerHtml(qd, q.responses?.[qd.id])}</div>
      </div>`;
  }).join("");
  w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(title)} — ${escapeHtml(coupleNames)}</title>
<style>
  @page { margin: 0.75in }
  body { font-family: Georgia, serif; color:#222; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-style: italic; font-size: 28px; color:#3a2a1a; margin: 0 0 4px; }
  .sub { color:#666; font-size:13px; margin-bottom: 24px; }
  @media print { .noprint { display:none } }
</style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">${escapeHtml(coupleNames || "")}${q.completed_at ? " · Submitted " + new Date(q.completed_at).toLocaleDateString() : ""}</div>
  ${body}
  <div class="noprint" style="margin-top:32px;text-align:center">
    <button onclick="window.print()" style="background:#7a5a3a;color:#fff;border:0;padding:10px 20px;border-radius:4px;font-size:14px;cursor:pointer">Save as PDF / Print</button>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
}
