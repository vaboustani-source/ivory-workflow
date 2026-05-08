import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lastFullWeek, thisWeekRange, lastMonthRange } from "@/lib/briefings";

type Preset = "last_week" | "this_week" | "last_month" | "custom";

export function GenerateBriefingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset>("last_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [emailToMe, setEmailToMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const resolveRange = () => {
    switch (preset) {
      case "last_week": return lastFullWeek();
      case "this_week": return thisWeekRange();
      case "last_month": return lastMonthRange();
      case "custom": return { start: customStart, end: customEnd };
    }
  };

  const handleGenerate = async () => {
    setError(null);
    const range = resolveRange();
    if (!range.start || !range.end) { setError("Pick a valid date range"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-briefing", {
        body: {
          period_start: range.start,
          period_end: range.end,
          email_to_me: emailToMe,
          generated_by: "on_demand",
        },
      });
      if (error) throw error;
      const id = (data as any)?.briefing_id;
      if (!id) throw new Error("No briefing id returned");
      onClose();
      navigate({ to: "/studio/briefings/$id", params: { id } });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-lg shadow-elevated max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-serif italic text-2xl text-primary">Generate briefing</h2>
            <p className="text-sm text-muted-foreground mt-1">Period to summarize</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="space-y-2 mb-4">
          {([
            ["last_week", "Last week"],
            ["this_week", "This week so far"],
            ["last_month", "Last month"],
            ["custom", "Custom range"],
          ] as [Preset, string][]).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="preset" checked={preset === k} onChange={() => setPreset(k)} />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="text-xs text-muted-foreground">Start
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="block w-full mt-1 px-2 py-1.5 bg-background border border-border rounded-sm text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">End
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="block w-full mt-1 px-2 py-1.5 bg-background border border-border rounded-sm text-sm" />
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input type="checkbox" checked={emailToMe} onChange={(e) => setEmailToMe(e.target.checked)} />
          <span>Email this to me</span>
        </label>

        {error && <p className="text-sm text-magenta mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-4 py-2 bg-primary text-background text-sm rounded-sm hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Generating briefing… ~10s" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
