import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTION_TYPES, ACTION_LABELS, RESPONSIBLE_PARTIES, RESPONSIBLE_LABELS,
  TRIGGER_TYPES, TRIGGER_RELATIVE_TO, ANCHOR_LABELS, TRIGGER_EVENTS,
  BRANCHES, BRANCH_LABELS, STAGE_LABELS, MERGE_FIELDS, substituteSample,
} from "@/lib/workflow-constants";

type Step = {
  id: string;
  workflow_template_id: string;
  step_number: number | null;
  stage: string | null;
  title: string | null;
  description: string | null;
  trigger_type: string | null;
  trigger_relative_to: string | null;
  trigger_offset_days: number | null;
  trigger_uses_business_days: boolean;
  trigger_event: string | null;
  responsible_party: string | null;
  action_type: string | null;
  branch_dependency: string | null;
  is_client_visible: boolean | null;
  email_template_id: string | null;
  reminder_offset_days: number | null;
  order_in_stage: number | null;
};

type EmailTemplate = { id: string; name: string | null; subject: string | null; body: string | null };

export function StepEditorModal({
  step, onClose, onSaved,
}: {
  step: Step;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Step>(step);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [reminderOn, setReminderOn] = useState((step.reminder_offset_days ?? 0) > 0);

  useEffect(() => {
    supabase.from("email_templates").select("id, name, subject, body").eq("is_active", true).order("name")
      .then(({ data }) => setTemplates((data ?? []) as EmailTemplate[]));
  }, []);

  const update = <K extends keyof Step>(k: K, v: Step[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload: Partial<Step> = {
      title: form.title,
      description: form.description,
      trigger_type: form.trigger_type,
      trigger_relative_to: form.trigger_type === "relative_date" ? form.trigger_relative_to : null,
      trigger_offset_days: form.trigger_type === "relative_date" ? form.trigger_offset_days : null,
      trigger_uses_business_days: form.trigger_type === "relative_date" ? form.trigger_uses_business_days : false,
      trigger_event: form.trigger_type === "event" ? form.trigger_event : null,
      responsible_party: form.responsible_party,
      action_type: form.action_type,
      branch_dependency: form.branch_dependency,
      is_client_visible: form.is_client_visible,
      email_template_id: form.action_type === "draft_email" ? form.email_template_id : null,
      reminder_offset_days: reminderOn ? form.reminder_offset_days ?? 1 : null,
    };
    const { error } = await supabase.from("workflow_steps").update(payload as never).eq("id", form.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Step updated");
    onSaved();
  };

  const remove = async () => {
    if (!confirm("Delete this step from the draft?")) return;
    const { error } = await supabase.from("workflow_steps").delete().eq("id", form.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Step deleted");
    onSaved();
  };

  const selectedTemplate = templates.find((t) => t.id === form.email_template_id);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-background w-full max-w-[640px] my-8 rounded-md shadow-elevated p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-magenta" aria-label="Close">
          <X size={18} />
        </button>
        <h2 className="font-serif italic text-[24px] text-primary">Edit step</h2>
        <p className="text-[13px] text-muted-foreground mt-1">{STAGE_LABELS[form.stage ?? ""] ?? form.stage} stage</p>

        {/* BASICS */}
        <Section title="Basics">
          <Field label="Title" required>
            <input className={inputCls} value={form.title ?? ""} onChange={(e) => update("title", e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className={inputCls} rows={3} value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} />
          </Field>
        </Section>

        {/* TRIGGER */}
        <Section title="Trigger">
          <Field label="Trigger type">
            <select className={inputCls} value={form.trigger_type ?? "relative_date"} onChange={(e) => update("trigger_type", e.target.value)}>
              {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t === "relative_date" ? "Relative date" : t === "event" ? "Event" : "Manual"}</option>)}
            </select>
          </Field>
          {form.trigger_type === "relative_date" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Offset days">
                  <input type="number" className={inputCls} value={form.trigger_offset_days ?? 0}
                    onChange={(e) => update("trigger_offset_days", parseInt(e.target.value) || 0)} />
                </Field>
                <Field label="Anchor">
                  <select className={inputCls} value={form.trigger_relative_to ?? "wedding_date"}
                    onChange={(e) => update("trigger_relative_to", e.target.value)}>
                    {TRIGGER_RELATIVE_TO.map((r) => <option key={r} value={r}>{ANCHOR_LABELS[r]}</option>)}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-foreground mt-2">
                <input type="checkbox" checked={form.trigger_uses_business_days}
                  onChange={(e) => update("trigger_uses_business_days", e.target.checked)} />
                Use business days for this offset
              </label>
            </>
          )}
          {form.trigger_type === "event" && (
            <Field label="Event name">
              <select className={inputCls} value={form.trigger_event ?? ""} onChange={(e) => update("trigger_event", e.target.value)}>
                <option value="">Select an event…</option>
                {TRIGGER_EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
          )}
          {form.trigger_type === "manual" && (
            <p className="text-[13px] text-muted-foreground italic">This step is created on-demand by Dexter or Victoria, not automatically.</p>
          )}
        </Section>

        {/* RESPONSIBILITY */}
        <Section title="Responsibility">
          <Field label="Responsible party">
            <select className={inputCls} value={form.responsible_party ?? "system"} onChange={(e) => update("responsible_party", e.target.value)}>
              {RESPONSIBLE_PARTIES.map((r) => <option key={r} value={r}>{RESPONSIBLE_LABELS[r]}</option>)}
            </select>
          </Field>
        </Section>

        {/* ACTION */}
        <Section title="Action">
          <Field label="Action type">
            <select className={inputCls} value={form.action_type ?? "create_task"} onChange={(e) => update("action_type", e.target.value)}>
              {ACTION_TYPES.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
            </select>
          </Field>
          {form.action_type === "draft_email" && (
            <>
              <Field label="Email template">
                <select className={inputCls} value={form.email_template_id ?? ""} onChange={(e) => update("email_template_id", e.target.value || null)}>
                  <option value="">— Use placeholder —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              {selectedTemplate && (
                <button type="button" onClick={() => setShowPreview((s) => !s)}
                  className="text-[13px] text-primary underline hover:text-magenta mt-1">
                  {showPreview ? "Hide preview" : "Preview email"}
                </button>
              )}
              {showPreview && selectedTemplate && (
                <div className="mt-3 p-4 bg-surface rounded-sm border border-border space-y-2">
                  <p className="text-[12px] text-muted-foreground uppercase tracking-wider">Subject</p>
                  <p className="text-[14px] text-foreground">{substituteSample(selectedTemplate.subject ?? "")}</p>
                  <p className="text-[12px] text-muted-foreground uppercase tracking-wider mt-3">Body</p>
                  <pre className="text-[13px] text-foreground whitespace-pre-wrap font-sans">{substituteSample(selectedTemplate.body ?? "")}</pre>
                </div>
              )}
            </>
          )}
        </Section>

        {/* BRANCH */}
        <Section title="Branch dependency">
          <Field label="Applies when">
            <select className={inputCls} value={form.branch_dependency ?? "always"} onChange={(e) => update("branch_dependency", e.target.value)}>
              {BRANCHES.map((b) => <option key={b} value={b}>{BRANCH_LABELS[b]}</option>)}
            </select>
          </Field>
          <p className="text-[12px] text-muted-foreground mt-1">
            "Always" means every couple. Otherwise it only fires for couples whose package matches.
          </p>
        </Section>

        {/* VISIBILITY */}
        <Section title="Visibility">
          <label className="flex items-center gap-2 text-[14px] text-foreground">
            <input type="checkbox" checked={form.is_client_visible ?? true} onChange={(e) => update("is_client_visible", e.target.checked)} />
            Visible to client in their portal
          </label>
          <p className="text-[12px] text-muted-foreground mt-1">
            Internal-only steps still create tasks but don't appear on the couple's timeline.
          </p>
        </Section>

        {/* REMINDERS */}
        <Section title="Reminders">
          <label className="flex items-center gap-2 text-[14px] text-foreground">
            <input type="checkbox" checked={reminderOn} onChange={(e) => setReminderOn(e.target.checked)} />
            Send a reminder if not actioned
          </label>
          {reminderOn && (
            <Field label="Days after due date">
              <input type="number" min={1} className={inputCls} value={form.reminder_offset_days ?? 1}
                onChange={(e) => update("reminder_offset_days", parseInt(e.target.value) || 1)} />
            </Field>
          )}
        </Section>

        {/* FOOTER */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <button onClick={remove} className="text-[13px] text-magenta hover:underline">Delete this step</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground text-[14px] rounded-sm hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 bg-surface border border-border rounded-sm text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-foreground mb-1">{label}{required && <span className="text-magenta"> *</span>}</label>
      {children}
    </div>
  );
}

// Suppress unused warning in case future use
void MERGE_FIELDS;
