import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Plus, Edit2, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { supabase } from "@/integrations/supabase/client";
import { EMAIL_TEMPLATE_STAGES, STAGE_LABELS } from "@/lib/workflow-constants";
import { EmailTemplateEditorModal, type EmailTemplate } from "@/components/workflow/EmailTemplateEditorModal";

export const Route = createFileRoute("/studio/settings/email-templates")({
  component: EmailTemplatesPage,
});

function EmailTemplatesPage() {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tpls } = await supabase
      .from("email_templates")
      .select("id, name, stage, subject, body, description, merge_fields, requires_approval, is_active, updated_at")
      .order("name");
    const items = (tpls ?? []) as (EmailTemplate & { updated_at: string })[];
    setTemplates(items);
    setUpdatedAt(Object.fromEntries(items.map((t) => [t.id, t.updated_at])));
    // Usage counts
    const counts: Record<string, number> = {};
    await Promise.all(items.map(async (t) => {
      const { count } = await supabase
        .from("workflow_steps")
        .select("id", { count: "exact", head: true })
        .eq("email_template_id", t.id);
      counts[t.id] = count ?? 0;
    }));
    setUsage(counts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!profile) return null;
  if (profile.role !== "owner") return <ComingSoonPanel />;

  const duplicate = async (t: EmailTemplate) => {
    const { error } = await supabase.from("email_templates").insert({
      name: `${t.name} (copy)`, stage: t.stage, subject: t.subject, body: t.body,
      description: t.description, requires_approval: t.requires_approval, is_active: t.is_active,
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Duplicated");
    await load();
  };

  const remove = async (t: EmailTemplate) => {
    if ((usage[t.id] ?? 0) > 0) {
      if (!confirm(`This template is used by ${usage[t.id]} workflow steps. Delete anyway?`)) return;
    } else if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("email_templates").delete().eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    await load();
  };

  const filtered = filter === "all" ? templates : templates.filter((t) => t.stage === filter);

  const onSaved = async () => {
    setEditing(null); setCreating(false);
    await load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary">Email Templates</h1>
          <p className="text-[14px] text-muted-foreground mt-1">The words that go out in your name.</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1 bg-primary text-primary-foreground text-[13px] px-4 py-2 rounded-sm hover:opacity-90">
          <Plus size={14} /> New template
        </button>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
        {EMAIL_TEMPLATE_STAGES.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>{STAGE_LABELS[s] ?? s}</FilterChip>
        ))}
      </div>

      {loading ? (
        <p className="text-[14px] text-muted-foreground italic">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-center font-serif italic text-[18px] text-muted-foreground py-12">
          {templates.length === 0 ? "No templates yet. Every email starts here." : "No templates in this stage."}
        </p>
      ) : (
        <div className="bg-surface rounded-sm border border-border shadow-soft overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-background-alt/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Stage</th>
                <th className="text-left px-4 py-3">Subject</th>
                <th className="text-left px-4 py-3">Used by</th>
                <th className="text-left px-4 py-3">Last edited</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} onClick={() => setEditing(t)} className="border-t border-border hover:bg-background-alt/30 cursor-pointer">
                  <td className="px-4 py-3 font-serif italic text-[16px] text-foreground">{t.name}</td>
                  <td className="px-4 py-3">
                    <span className="bg-plum/15 text-plum text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">
                      {STAGE_LABELS[t.stage ?? ""] ?? t.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[14px] text-foreground max-w-[320px] truncate">{t.subject}</td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">{usage[t.id] ?? 0} step{usage[t.id] === 1 ? "" : "s"}</td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">{updatedAt[t.id] ? relative(updatedAt[t.id]) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setEditing(t)} className="p-1.5 text-muted-foreground hover:text-primary" aria-label="Edit"><Edit2 size={14} /></button>
                      <button onClick={() => duplicate(t)} className="p-1.5 text-muted-foreground hover:text-primary" aria-label="Duplicate"><Copy size={14} /></button>
                      <button onClick={() => remove(t)} className="p-1.5 text-muted-foreground hover:text-magenta" aria-label="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <EmailTemplateEditorModal
          template={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] uppercase tracking-wider px-3 py-1.5 rounded-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-foreground border border-border"
      }`}>
      {children}
    </button>
  );
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
