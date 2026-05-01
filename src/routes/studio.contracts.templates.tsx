import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/dates";
import { Plus, FileText } from "lucide-react";

export const Route = createFileRoute("/studio/contracts/templates")({
  component: ContractTemplatesPage,
});

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  signature_required_role: string;
  is_archived: boolean;
  created_by: string | null;
  updated_at: string;
  creator: { full_name: string | null } | null;
}

function ContractTemplatesPage() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("contract_templates")
        .select("id, name, description, signature_required_role, is_archived, created_by, updated_at, creator:profiles!contract_templates_created_by_fkey(full_name)")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      setRows((data ?? []) as any);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const visible = rows.filter((r) => showArchived || !r.is_archived);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to="/studio/contracts" className="hover:text-primary">Contracts</Link>
            <span className="mx-2">/</span>
            <span>Templates</span>
          </p>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight mt-1">Contract Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">Reusable contracts you can send to couples.</p>
        </div>
        <Link
          to="/studio/contracts/templates/$id"
          params={{ id: "new" }}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
        >
          <Plus size={14} /> New template
        </Link>
      </header>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />
          Show archived
        </label>
      </div>

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <FileText size={32} className="text-gold mx-auto mb-3" />
          <p className="font-serif italic text-2xl text-primary">No templates yet.</p>
          <p className="text-sm text-muted-foreground mt-2">Create your first contract template to reuse across couples.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((t) => (
            <Link
              key={t.id}
              to="/studio/contracts/templates/$id"
              params={{ id: t.id }}
              className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-5 flex flex-col hover:border-primary transition-colors group"
            >
              <h3 className="font-serif italic text-xl text-primary group-hover:text-magenta transition-colors">
                {t.name}
                {t.is_archived && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">(archived)</span>}
              </h3>
              {t.description && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2 flex-1">{t.description}</p>
              )}
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-3">
                {t.signature_required_role === "both_partners" ? "Both partners" : "Single signer"}
              </p>
              <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                <span>{t.creator?.full_name ?? "—"}</span>
                <span>Updated {relativeTime(t.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
