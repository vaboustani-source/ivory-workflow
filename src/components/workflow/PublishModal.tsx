import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STAGE_LABELS } from "@/lib/workflow-constants";

type Impact = {
  steps: {
    added: { id: string; title: string; stage: string }[];
    removed: { id: string; title: string; stage: string }[];
    changed: { id: string; title: string; stage: string; old: Record<string, unknown>; new: Record<string, unknown> }[];
    unchanged_count: number;
  };
  couples_affected: number;
  milestones_affected: number;
  new_version: number;
  archived_version: number | null;
};

export function PublishModal({
  draftId, onClose, onPublished,
}: {
  draftId: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);
  const [changelog, setChangelog] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("preview_publish_impact", { _draft_id: draftId });
      if (error) toast.error(error.message);
      else setImpact(data as unknown as Impact);
      setLoading(false);
    })();
  }, [draftId]);

  const publish = async () => {
    setPublishing(true);
    // Save changelog to draft
    if (changelog.trim()) {
      await supabase.from("workflow_templates").update({ draft_changelog: changelog }).eq("id", draftId);
    }
    const { data, error } = await supabase.rpc("publish_draft", { _draft_id: draftId, _migrate_couples: migrate });
    setPublishing(false);
    if (error) { toast.error(error.message); return; }
    const result = data as { version: number; migrated_couples: number };
    toast.success(`v${result.version} published. ${result.migrated_couples} couples migrated.`);
    onPublished();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-background w-full max-w-[720px] my-8 rounded-md shadow-elevated p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-magenta"><X size={18} /></button>

        <h2 className="font-serif italic text-[28px] text-primary">
          Publish v{impact?.new_version ?? "—"}?
        </h2>
        <p className="text-[14px] text-muted-foreground mt-1">Here's what will change.</p>

        {/* Changelog */}
        <div className="mt-6">
          <label className="block text-[13px] text-foreground mb-1">What changed? (optional, for the team)</label>
          <textarea rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-sm text-[14px]" />
          <p className="text-[12px] text-muted-foreground mt-1">Describe these changes in plain language. Future you will thank you.</p>
        </div>

        {loading && <p className="mt-6 text-[14px] text-muted-foreground italic">Calculating impact…</p>}

        {impact && (
          <>
            {/* STEPS */}
            <div className="mt-8">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Steps</h3>
              <div className="space-y-3">
                <ChangeBlock label={`${impact.steps.added.length} steps added`} colorClass="text-sage-foreground bg-sage/15">
                  {impact.steps.added.map((s) => (
                    <div key={s.id} className="text-[13px] text-foreground py-1">
                      <span className="text-muted-foreground">{STAGE_LABELS[s.stage] ?? s.stage} ·</span> {s.title}
                    </div>
                  ))}
                </ChangeBlock>
                <ChangeBlock label={`${impact.steps.changed.length} steps changed`} colorClass="text-plum bg-gold/20">
                  {impact.steps.changed.map((s) => (
                    <div key={s.id} className="text-[13px] py-1">
                      <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="text-foreground hover:text-primary text-left">
                        <span className="text-muted-foreground">{STAGE_LABELS[s.stage] ?? s.stage} ·</span> {s.title}
                      </button>
                      {expanded === s.id && (
                        <div className="mt-1 ml-3 text-[12px] text-muted-foreground">
                          <DiffRow label="Offset" o={s.old.trigger_offset_days} n={s.new.trigger_offset_days} />
                          <DiffRow label="Anchor" o={s.old.trigger_relative_to} n={s.new.trigger_relative_to} />
                          <DiffRow label="Branch" o={s.old.branch_dependency} n={s.new.branch_dependency} />
                          <DiffRow label="Action" o={s.old.action_type} n={s.new.action_type} />
                          <DiffRow label="Visible" o={s.old.is_client_visible} n={s.new.is_client_visible} />
                          <DiffRow label="Description" o={s.old.description} n={s.new.description} />
                        </div>
                      )}
                    </div>
                  ))}
                </ChangeBlock>
                <ChangeBlock label={`${impact.steps.removed.length} steps removed`} colorClass="text-magenta bg-magenta/10">
                  {impact.steps.removed.map((s) => (
                    <div key={s.id} className="text-[13px] text-foreground py-1 line-through opacity-70">
                      <span className="text-muted-foreground no-underline">{STAGE_LABELS[s.stage] ?? s.stage} ·</span> {s.title}
                    </div>
                  ))}
                </ChangeBlock>
                <p className="text-[13px] text-muted-foreground italic">{impact.steps.unchanged_count} steps unchanged</p>
              </div>
            </div>

            {/* COUPLES */}
            <div className="mt-8">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">In-flight couples</h3>
              <p className="text-[14px] text-foreground">{impact.couples_affected} couples currently booked or active will be affected.</p>
              <p className="text-[14px] text-foreground">{impact.milestones_affected} of their upcoming milestones will be updated.</p>
              <label className="flex items-center gap-2 mt-3 text-[14px] text-foreground">
                <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
                Migrate existing couples
              </label>
              <p className="text-[12px] text-muted-foreground mt-1">
                Completed and skipped milestones are never modified, only upcoming ones.
              </p>
            </div>

            {/* WHAT STAYS */}
            <div className="mt-8">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">What stays the same</h3>
              <ul className="text-[13px] text-muted-foreground space-y-1">
                <li>· Every couple's already-completed work</li>
                <li>· Every email already sent or drafted</li>
                <li>· The workflow engine logic itself</li>
              </ul>
            </div>
          </>
        )}

        {/* ACTIONS */}
        <div className="flex items-center justify-end gap-2 mt-8 pt-6 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={publish} disabled={publishing || !impact}
            className="px-5 py-2 bg-primary text-primary-foreground text-[14px] rounded-sm hover:opacity-90 disabled:opacity-50">
            {publishing ? "Publishing…" : `Publish v${impact?.new_version ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeBlock({ label, colorClass, children }: { label: string; colorClass: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={`inline-block px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider ${colorClass}`}>{label}</span>
      <div className="mt-2 pl-2">{children}</div>
    </div>
  );
}

function DiffRow({ label, o, n }: { label: string; o: unknown; n: unknown }) {
  if (JSON.stringify(o) === JSON.stringify(n)) return null;
  return (
    <div className="py-0.5">
      <span className="text-foreground">{label}:</span>{" "}
      <span className="line-through opacity-60">{String(o ?? "—")}</span>{" → "}
      <span className="text-primary">{String(n ?? "—")}</span>
    </div>
  );
}
