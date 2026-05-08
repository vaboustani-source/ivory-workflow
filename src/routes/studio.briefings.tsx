import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateRange, type BriefingRow } from "@/lib/briefings";
import { GenerateBriefingModal } from "@/components/studio/GenerateBriefingModal";

export const Route = createFileRoute("/studio/briefings")({
  component: BriefingsListPage,
});

function BriefingsListPage() {
  const [rows, setRows] = useState<BriefingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    supabase
      .from("briefings")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setRows((data ?? []) as any);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary">Briefings</h1>
          <p className="text-sm text-muted-foreground mt-1">Weekly status summaries</p>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-primary text-background px-4 py-2 rounded-sm text-sm hover:opacity-90">
          <Plus size={14} /> Generate now
        </button>
      </div>

      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {loading ? (
          <p className="font-serif italic text-primary text-center py-16">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No briefings yet. Generate your first one.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3">Period</th>
                <th className="px-6 py-3">Summary</th>
                <th className="px-6 py-3">Generated</th>
                <th className="px-6 py-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const firstSentence = (b.ai_summary ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
                return (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-background-alt/40 cursor-pointer" onClick={() => window.location.assign(`/studio/briefings/${b.id}`)}>
                    <td className="px-6 py-4">
                      <Link to="/studio/briefings/$id" params={{ id: b.id }} className="font-serif italic text-base text-primary" onClick={(e) => e.stopPropagation()}>
                        {fmtDateRange(b.period_start, b.period_end)}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground max-w-[480px] truncate">{firstSentence || "—"}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{new Date(b.generated_at).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm capitalize text-muted-foreground">{b.generated_by.replace(/_/g, " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <GenerateBriefingModal open={open} onClose={() => { setOpen(false); load(); }} />
    </div>
  );
}
