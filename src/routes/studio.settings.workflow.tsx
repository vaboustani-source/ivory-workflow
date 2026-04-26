import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, ChevronDown, ChevronUp, MoreVertical, Plus, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { supabase } from "@/integrations/supabase/client";
import {
  WORKFLOW_STAGES, STAGE_LABELS, ACTION_LABELS, ACTION_CHIP_CLASS,
  RESPONSIBLE_LABELS, ANCHOR_LABELS, BRANCH_PILL_LABELS,
} from "@/lib/workflow-constants";
import { StepEditorModal } from "@/components/workflow/StepEditorModal";
import { PublishModal } from "@/components/workflow/PublishModal";
import { VersionHistoryModal } from "@/components/workflow/VersionHistoryModal";

export const Route = createFileRoute("/studio/settings/workflow")({
  component: WorkflowEditorPage,
});

type Template = {
  id: string;
  name: string | null;
  version: number | null;
  status: string;
  is_active: boolean | null;
  parent_version_id: string | null;
  published_at: string | null;
  published_by: string | null;
  draft_changelog: string | null;
  created_at: string;
};

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

function WorkflowEditorPage() {
  const { profile } = useAuth();
  const [published, setPublished] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [publisherName, setPublisherName] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [publishedSteps, setPublishedSteps] = useState<Step[]>([]);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: tpls } = await supabase
      .from("workflow_templates")
      .select("*")
      .in("status", ["published", "draft"]);

    const pub = (tpls ?? []).find((t) => t.status === "published" && t.is_active) as Template | undefined;
    const drf = (tpls ?? []).find((t) => t.status === "draft") as Template | undefined;
    setPublished(pub ?? null);
    setDraft(drf ?? null);

    if (pub?.published_by) {
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", pub.published_by).maybeSingle();
      setPublisherName(p?.full_name ?? null);
    }

    if (pub) {
      const { data: ps } = await supabase.from("workflow_steps").select("*").eq("workflow_template_id", pub.id);
      setPublishedSteps((ps ?? []) as Step[]);
    }
    const showId = drf?.id ?? pub?.id;
    if (showId) {
      const { data: s } = await supabase.from("workflow_steps").select("*").eq("workflow_template_id", showId);
      setSteps((s ?? []) as Step[]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!profile) return null;
  if (profile.role !== "owner") return <ComingSoonPanel />;

  const startEditing = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_draft_from_published");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Draft created");
    setEditing(true);
    await load();
    void data;
  };

  const resumeDraft = () => setEditing(true);

  const discardDraft = async () => {
    if (!draft) return;
    if (!confirm("Discard the draft? This cannot be undone.")) return;
    const { error } = await supabase.rpc("discard_draft", { _draft_id: draft.id });
    if (error) { toast.error(error.message); return; }
    toast.success("Draft discarded");
    setEditing(false);
    await load();
  };

  const onPublished = async () => {
    setShowPublish(false);
    setEditing(false);
    await load();
  };

  const onStepSaved = async () => {
    setEditingStep(null);
    await load();
  };

  const addStep = async (stage: string) => {
    if (!draft) return;
    const stageSteps = steps.filter((s) => s.stage === stage);
    const maxOrder = stageSteps.reduce((m, s) => Math.max(m, s.order_in_stage ?? 0), 0);
    const maxStep = steps.reduce((m, s) => Math.max(m, s.step_number ?? 0), 0);
    const { data, error } = await supabase.from("workflow_steps").insert({
      workflow_template_id: draft.id,
      step_number: maxStep + 1,
      stage,
      title: "Untitled step",
      trigger_type: "manual",
      action_type: "create_task",
      responsible_party: "owner",
      branch_dependency: "always",
      is_client_visible: true,
      order_in_stage: maxOrder + 10,
    } as never).select().single();
    if (error) { toast.error(error.message); return; }
    await load();
    setEditingStep(data as unknown as Step);
  };

  const isEditMode = editing && draft !== null;
  const visibleSteps = isEditMode ? steps : publishedSteps;
  const currentSteps = isEditMode ? steps : publishedSteps;

  // Diff index: by title, in published vs current draft
  const publishedTitles = new Set(publishedSteps.map((s) => s.title ?? ""));
  const draftTitles = new Set(steps.map((s) => s.title ?? ""));
  const isNewInDraft = (s: Step) => isEditMode && !publishedTitles.has(s.title ?? "");
  const isChangedInDraft = (s: Step) => {
    if (!isEditMode) return false;
    const p = publishedSteps.find((x) => x.title === s.title);
    if (!p) return false;
    return (
      p.trigger_offset_days !== s.trigger_offset_days ||
      p.trigger_relative_to !== s.trigger_relative_to ||
      p.branch_dependency !== s.branch_dependency ||
      p.is_client_visible !== s.is_client_visible ||
      p.action_type !== s.action_type ||
      p.responsible_party !== s.responsible_party ||
      (p.description ?? "") !== (s.description ?? "")
    );
  };
  const removedInDraft = isEditMode
    ? publishedSteps.filter((p) => !draftTitles.has(p.title ?? ""))
    : [];

  const toggleStage = (stage: string) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const triggerSummary = (s: Step): string => {
    if (s.trigger_type === "event") return `On event: ${s.trigger_event ?? "?"}`;
    if (s.trigger_type === "manual") return "Manual";
    const offset = s.trigger_offset_days ?? 0;
    const sign = offset > 0 ? "+" : "";
    const unit = s.trigger_uses_business_days ? "biz days" : "days";
    return `${sign}${offset} ${unit} from ${ANCHOR_LABELS[s.trigger_relative_to ?? ""] ?? "?"}`;
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary">Workflow</h1>
        <p className="text-[14px] text-muted-foreground mt-1">The journey every couple takes through Stories by Victoria.</p>
      </header>

      {/* Banner */}
      {!isEditMode ? (
        <div className="bg-plum text-cream rounded-sm p-4 flex items-center gap-4">
          <div className="flex-1">
            <p className="font-serif italic text-gold text-[16px]">Currently published: v{published?.version ?? "—"}</p>
            <p className="text-[13px] text-cream/80">
              {published?.published_at ? `Last updated ${new Date(published.published_at).toLocaleDateString()}` : "—"}
              {publisherName ? ` by ${publisherName}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(true)} className="text-[13px] text-cream/90 hover:text-gold underline">
              Version history
            </button>
            {draft ? (
              <button onClick={resumeDraft} disabled={busy}
                className="bg-cream text-plum text-[13px] px-4 py-2 rounded-sm hover:opacity-90">
                Resume editing draft v{draft.version}
              </button>
            ) : (
              <button onClick={startEditing} disabled={busy}
                className="border border-gold text-gold text-[13px] px-4 py-2 rounded-sm hover:bg-gold hover:text-plum">
                Edit workflow
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-magenta text-cream rounded-sm p-4 flex items-center gap-4">
          <div className="flex-1 flex items-center gap-3">
            <p className="font-serif italic text-cream text-[16px]">Editing draft v{draft?.version}</p>
            <span className="bg-cream/20 text-cream text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">DRAFT</span>
            <span className="text-[13px] text-cream/80">Changes won't take effect until you publish</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={discardDraft} className="text-[13px] text-cream/90 hover:text-cream underline">Discard draft</button>
            <button onClick={() => setShowPublish(true)} className="bg-primary text-primary-foreground text-[13px] px-4 py-2 rounded-sm hover:opacity-90">
              Preview & publish
            </button>
          </div>
        </div>
      )}

      {/* Stages */}
      <div className="space-y-4">
        {WORKFLOW_STAGES.map((stage) => {
          const stageSteps = visibleSteps
            .filter((s) => s.stage === stage)
            .sort((a, b) => (a.order_in_stage ?? 0) - (b.order_in_stage ?? 0));
          const removedInStage = removedInDraft.filter((s) => s.stage === stage);
          const totalCount = stageSteps.length + removedInStage.length;
          const isCollapsed = collapsed.has(stage);

          if (totalCount === 0 && !isEditMode) return null;

          return (
            <section key={stage} className="bg-surface rounded-sm border border-border">
              <button onClick={() => toggleStage(stage)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-background-alt/40">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] uppercase tracking-wider text-foreground">{STAGE_LABELS[stage]}</span>
                  <span className="text-[12px] text-muted-foreground">{totalCount} step{totalCount === 1 ? "" : "s"}</span>
                </div>
                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>

              {!isCollapsed && (
                <div className="p-4 space-y-3 border-t border-border">
                  {stageSteps.map((s) => (
                    <StepRow key={s.id} step={s} editMode={isEditMode}
                      isNew={isNewInDraft(s)} isChanged={isChangedInDraft(s)}
                      triggerSummary={triggerSummary(s)}
                      onEdit={() => setEditingStep(s)} />
                  ))}
                  {removedInStage.map((s) => (
                    <div key={s.id} className="bg-background rounded-sm border border-border p-4 opacity-60">
                      <div className="flex items-center gap-3">
                        <span className="bg-magenta/20 text-magenta text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">Removed</span>
                        <span className="text-[14px] text-foreground line-through">{s.title}</span>
                      </div>
                    </div>
                  ))}
                  {isEditMode && (
                    <button onClick={() => addStep(stage)}
                      className="w-full flex items-center justify-center gap-1 py-2 text-[13px] text-muted-foreground border border-dashed border-border rounded-sm hover:text-primary hover:border-primary">
                      <Plus size={14} /> Add step
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {currentSteps.length === 0 && (
        <p className="text-center text-[14px] text-muted-foreground italic py-12">
          No workflow steps yet.
        </p>
      )}

      {editingStep && <StepEditorModal step={editingStep} onClose={() => setEditingStep(null)} onSaved={onStepSaved} />}
      {showPublish && draft && <PublishModal draftId={draft.id} onClose={() => setShowPublish(false)} onPublished={onPublished} />}
      {showHistory && <VersionHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function StepRow({
  step, editMode, isNew, isChanged, triggerSummary, onEdit,
}: {
  step: Step; editMode: boolean; isNew: boolean; isChanged: boolean; triggerSummary: string; onEdit: () => void;
}) {
  return (
    <div className="group bg-background rounded-sm border border-border p-4 hover:shadow-soft transition-shadow relative">
      <div className="flex items-start gap-4">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground pt-0.5 w-8 shrink-0">#{step.step_number}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isNew && <span className="bg-sage/30 text-sage-foreground text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">New</span>}
            {isChanged && <span className="w-2 h-2 rounded-full bg-gold inline-block" title="Modified in draft" />}
            <h4 className="text-[14px] text-foreground truncate">{step.title}</h4>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">{triggerSummary}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {step.responsible_party && (
            <span className="bg-muted text-foreground text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">
              {RESPONSIBLE_LABELS[step.responsible_party]}
            </span>
          )}
          {step.action_type && (
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ${ACTION_CHIP_CLASS[step.action_type] ?? "bg-muted"}`}>
              {ACTION_LABELS[step.action_type]}
            </span>
          )}
          {step.branch_dependency && step.branch_dependency !== "always" && (
            <span className="bg-plum/15 text-plum text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">
              {BRANCH_PILL_LABELS[step.branch_dependency] ?? step.branch_dependency}
            </span>
          )}
          {step.is_client_visible
            ? <Eye size={14} className="text-muted-foreground" />
            : <EyeOff size={14} className="text-muted-foreground" />}
        </div>
        {editMode && (
          <button onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary p-1"
            aria-label="Edit step">
            <Edit2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

void MoreVertical;
