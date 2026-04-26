import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Version = {
  id: string;
  version: number;
  status: string;
  published_at: string | null;
  draft_changelog: string | null;
  published_by: string | null;
  step_count: number;
  publisher_name: string | null;
};

export function VersionHistoryModal({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tpls } = await supabase
        .from("workflow_templates")
        .select("id, version, status, published_at, draft_changelog, published_by")
        .order("version", { ascending: false });
      const items = tpls ?? [];
      const stepCounts = await Promise.all(items.map(async (t) => {
        const { count } = await supabase.from("workflow_steps").select("id", { count: "exact", head: true }).eq("workflow_template_id", t.id);
        return count ?? 0;
      }));
      const publisherIds = items.map((t) => t.published_by).filter(Boolean) as string[];
      const { data: profs } = publisherIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", publisherIds)
        : { data: [] as { id: string; full_name: string | null }[] };
      const profMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
      setVersions(items.map((t, i) => ({
        ...t,
        step_count: stepCounts[i],
        publisher_name: t.published_by ? profMap.get(t.published_by) ?? null : null,
      })) as Version[]);
      setLoading(false);
    })();
  }, []);

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      published: "bg-sage/30 text-sage-foreground",
      archived: "bg-muted text-muted-foreground",
      draft: "bg-gold/30 text-plum",
    };
    return map[status] ?? "bg-muted";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-background w-full max-w-[640px] my-8 rounded-md shadow-elevated p-8 relative" style={{ maxHeight: "80vh", overflowY: "auto" }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-magenta"><X size={18} /></button>
        <h2 className="font-serif italic text-[24px] text-primary">Version history</h2>

        {loading && <p className="mt-6 text-[14px] text-muted-foreground italic">Loading…</p>}

        <div className="mt-6 space-y-3">
          {versions.map((v) => (
            <div key={v.id} className="bg-surface rounded-sm border border-border p-4">
              <div className="flex items-center gap-2">
                <span className="bg-plum/15 text-plum text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-sm">v{v.version}</span>
                <span className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-sm ${statusPill(v.status)}`}>{v.status}</span>
                <span className="text-[12px] text-muted-foreground">· {v.step_count} steps</span>
              </div>
              {v.published_at && (
                <p className="text-[13px] text-muted-foreground mt-2">
                  Published {new Date(v.published_at).toLocaleDateString()} {v.publisher_name ? `by ${v.publisher_name}` : ""}
                </p>
              )}
              {v.draft_changelog && (
                <p className="text-[13px] italic text-foreground mt-1">"{v.draft_changelog}"</p>
              )}
              <div className="mt-2 text-right">
                <span className="text-[12px] text-muted-foreground italic" title="Read-only view coming soon">View (soon)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
