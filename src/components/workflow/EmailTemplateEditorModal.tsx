import { useEffect, useState, useRef } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EMAIL_TEMPLATE_STAGES, MERGE_FIELDS, STAGE_LABELS, substituteSample } from "@/lib/workflow-constants";

export type EmailTemplate = {
  id: string;
  name: string | null;
  stage: string | null;
  subject: string | null;
  body: string | null;
  description: string | null;
  merge_fields: unknown;
  requires_approval: boolean | null;
  is_active: boolean | null;
};

const empty: EmailTemplate = {
  id: "",
  name: "",
  stage: "welcome",
  subject: "",
  body: "",
  description: "",
  merge_fields: null,
  requires_approval: true,
  is_active: true,
};

export function EmailTemplateEditorModal({
  template, onClose, onSaved,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EmailTemplate>(template ?? empty);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [activeField, setActiveField] = useState<"subject" | "body">("body");

  const update = <K extends keyof EmailTemplate>(k: K, v: EmailTemplate[K]) => setForm((f) => ({ ...f, [k]: v }));

  const insertField = (field: string) => {
    if (activeField === "subject") {
      const el = subjectRef.current;
      if (!el) return;
      const start = el.selectionStart ?? form.subject?.length ?? 0;
      const end = el.selectionEnd ?? start;
      const text = form.subject ?? "";
      const next = text.slice(0, start) + field + text.slice(end);
      update("subject", next);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + field.length, start + field.length); }, 0);
    } else {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart ?? form.body?.length ?? 0;
      const end = el.selectionEnd ?? start;
      const text = form.body ?? "";
      const next = text.slice(0, start) + field + text.slice(end);
      update("body", next);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + field.length, start + field.length); }, 0);
    }
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    const payload = {
      name: form.name, stage: form.stage, subject: form.subject, body: form.body,
      description: form.description, requires_approval: form.requires_approval, is_active: form.is_active,
    };
    const { error } = template
      ? await supabase.from("email_templates").update(payload).eq("id", template.id)
      : await supabase.from("email_templates").insert(payload as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(template ? "Template saved" : "Template created");
    onSaved();
  };

  const remove = async () => {
    if (!template) return;
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("email_templates").delete().eq("id", template.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Template deleted");
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-background w-full max-w-[720px] my-8 rounded-md shadow-elevated p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-magenta"><X size={18} /></button>

        <div className="flex items-center justify-between">
          <h2 className="font-serif italic text-[24px] text-primary">{template ? "Edit template" : "New template"}</h2>
          <button onClick={() => setPreview((p) => !p)}
            className="text-[13px] text-primary underline hover:text-magenta">
            {preview ? "Edit" : "Preview"}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6 mt-6">
          {/* MAIN */}
          <div className="col-span-2 space-y-4">
            <div>
              <label className="block text-[12px] text-foreground mb-1">Name <span className="text-magenta">*</span></label>
              <input className={inputCls} value={form.name ?? ""} onChange={(e) => update("name", e.target.value)} />
            </div>
            <div>
              <label className="block text-[12px] text-foreground mb-1">Stage</label>
              <select className={inputCls} value={form.stage ?? ""} onChange={(e) => update("stage", e.target.value)}>
                {EMAIL_TEMPLATE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-foreground mb-1">Description</label>
              <textarea rows={2} className={inputCls} value={form.description ?? ""} onChange={(e) => update("description", e.target.value)}
                placeholder="When this email goes out in the workflow" />
            </div>
            <div>
              <label className="block text-[12px] text-foreground mb-1">Subject</label>
              {preview ? (
                <div className="px-3 py-2 bg-surface border border-border rounded-sm text-[14px] text-foreground">
                  {substituteSample(form.subject ?? "")}
                </div>
              ) : (
                <input ref={subjectRef} className={inputCls} value={form.subject ?? ""}
                  onFocus={() => setActiveField("subject")}
                  onChange={(e) => update("subject", e.target.value)} />
              )}
            </div>
            <div>
              <label className="block text-[12px] text-foreground mb-1">Body</label>
              {preview ? (
                <pre className="px-3 py-2 bg-surface border border-border rounded-sm text-[13px] text-foreground whitespace-pre-wrap font-sans min-h-[300px]">
                  {substituteSample(form.body ?? "")}
                </pre>
              ) : (
                <textarea ref={bodyRef} rows={16} className={`${inputCls} font-mono text-[13px]`}
                  onFocus={() => setActiveField("body")}
                  value={form.body ?? ""} onChange={(e) => update("body", e.target.value)} />
              )}
            </div>
          </div>

          {/* MERGE FIELDS */}
          <aside className="bg-surface rounded-sm border border-border p-3 self-start">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Available merge fields</h4>
            <div className="space-y-1">
              {MERGE_FIELDS.map((m) => (
                <button key={m.field} type="button" onClick={() => insertField(m.field)}
                  className="w-full text-left px-2 py-1 rounded-sm hover:bg-background-alt/40">
                  <div className="text-[12px] text-foreground font-mono">{m.field}</div>
                  <div className="text-[10px] text-muted-foreground">{m.description}</div>
                </button>
              ))}
            </div>
          </aside>
        </div>

        {/* ADVANCED */}
        <div className="mt-6 pt-6 border-t border-border">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Advanced</h3>
          <label className="flex items-center gap-2 text-[14px] text-foreground">
            <input type="checkbox" checked={form.requires_approval ?? true} onChange={(e) => update("requires_approval", e.target.checked)} />
            Requires approval before sending
          </label>
          <p className="text-[12px] text-muted-foreground mt-1">When OFF, this email sends immediately when the workflow drafts it. Use sparingly.</p>
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          {template ? (
            <button onClick={remove} className="text-[13px] text-magenta hover:underline">Delete</button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground text-[14px] rounded-sm hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 bg-surface border border-border rounded-sm text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";
