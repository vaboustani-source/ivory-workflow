import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { shortDate } from "@/lib/dates";
import { X } from "lucide-react";

export const Route = createFileRoute("/portal/timeline")({
  component: PortalTimelineRoute,
});

function PortalTimelineRoute() {
  return <PortalGate>{({ clientId }) => <PortalTimeline clientId={clientId} />}</PortalGate>;
}

interface Milestone {
  id: string;
  title: string | null;
  description: string | null;
  due_date: string | null;
  status: string;
  stage: string | null;
  completed_at: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  inquiry: "Getting started",
  welcome: "Welcome",
  engagement: "Your engagement session",
  pre_wedding: "The weeks before",
  wedding_day: "Your wedding day",
  post_wedding: "After the day",
  album: "Your album",
  long_tail: "Your gallery",
};

const STAGE_ORDER = ["inquiry", "welcome", "engagement", "pre_wedding", "wedding_day", "post_wedding", "album", "long_tail"];

const STATUS_LABEL: Record<string, string> = {
  complete: "Complete ✓",
  in_progress: "Up next",
  upcoming: "Coming up",
  skipped: "Skipped",
};

function PortalTimeline({ clientId }: { clientId: string }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Milestone | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("timeline_milestones")
        .select("id, title, description, due_date, status, stage, completed_at")
        .eq("client_id", clientId)
        .eq("is_client_visible", true)
        .order("due_date", { ascending: true, nullsFirst: false });
      setMilestones((data ?? []) as Milestone[]);
      setLoading(false);
    })();
  }, [clientId]);

  const grouped = STAGE_ORDER.map((stage) => ({
    stage, items: milestones.filter((m) => m.stage === stage),
  })).filter((g) => g.items.length > 0);
  const ungrouped = milestones.filter((m) => !m.stage || !STAGE_ORDER.includes(m.stage));

  return (
    <div>
      <div className="text-center mb-10">
        <h1 className="font-serif italic text-[28px] md:text-[32px] text-primary">Your journey</h1>
        <p className="text-sm text-muted-foreground mt-2">Every step we'll take together.</p>
      </div>

      {loading ? (
        <p className="font-serif italic text-center text-muted-foreground">Loading…</p>
      ) : milestones.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold max-w-xl mx-auto">
          <p className="font-serif italic text-xl text-primary">
            Your journey will begin to appear here as we move forward together.
          </p>
        </div>
      ) : (
        <div className="max-w-[720px] mx-auto relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-gold/60 -translate-x-1/2 hidden md:block" />
          {grouped.map(({ stage, items }) => (
            <div key={stage} className="mb-10">
              <div className="flex items-center gap-3 mb-6 relative z-10">
                <span className="flex-1 h-px bg-gold/40" />
                <span className="text-[11px] uppercase tracking-wider text-primary/70 bg-background px-3">
                  {STAGE_LABELS[stage] ?? stage.replace(/_/g, " ")}
                </span>
                <span className="flex-1 h-px bg-gold/40" />
              </div>
              {items.map((m, idx) => <Node key={m.id} m={m} index={idx} onClick={() => setSelected(m)} />)}
            </div>
          ))}
          {ungrouped.map((m, idx) => <Node key={m.id} m={m} index={idx} onClick={() => setSelected(m)} />)}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-surface rounded-lg shadow-elevated w-full max-w-[480px] p-6 border-t-2 border-gold" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-serif italic text-xl text-primary">{selected.title}</h3>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
            </div>
            {selected.description && <p className="text-sm text-foreground mb-4">{selected.description}</p>}
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">When</dt><dd>{selected.due_date ? shortDate(selected.due_date) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Status</dt><dd>{STATUS_LABEL[selected.status] ?? selected.status}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

function Node({ m, index, onClick }: { m: Milestone; index: number; onClick: () => void }) {
  const onRight = index % 2 === 0;
  const dotClass =
    m.status === "complete" ? "bg-sage text-background" :
    m.status === "in_progress" ? "bg-gold" :
    m.status === "skipped" ? "bg-muted-foreground" :
    "bg-background border-2 border-gold";

  return (
    <div className="relative my-4 md:flex md:items-center md:min-h-[60px]">
      {/* Mobile: stack always */}
      <div className="md:hidden">
        <Card m={m} onClick={onClick} />
      </div>
      {/* Desktop: alternating */}
      <div className="hidden md:flex md:w-full md:items-center">
        {!onRight && <div className="w-1/2 pr-8 flex justify-end"><Card m={m} onClick={onClick} /></div>}
        {!onRight && <div className="w-1/2" />}
        {onRight && <div className="w-1/2" />}
        {onRight && <div className="w-1/2 pl-8"><Card m={m} onClick={onClick} /></div>}
        <div className={`absolute left-1/2 -translate-x-1/2 h-6 w-6 rounded-full flex items-center justify-center z-10 ${dotClass}`}>
          {m.status === "complete" && <span className="text-[10px]">✓</span>}
        </div>
      </div>
    </div>
  );
}

function Card({ m, onClick }: { m: Milestone; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-surface rounded-md shadow-soft p-3 w-full md:w-[260px] text-left hover:shadow-elevated transition-shadow border border-border">
      <p className="text-sm text-foreground font-medium">{m.title}</p>
      <p className="text-xs text-muted-foreground mt-1">{m.due_date ? shortDate(m.due_date) : "—"}</p>
      <p className={`text-[10px] uppercase tracking-wider mt-1 ${
        m.status === "complete" ? "text-sage" :
        m.status === "in_progress" ? "text-gold" :
        "text-muted-foreground"
      }`}>{STATUS_LABEL[m.status] ?? m.status}</p>
    </button>
  );
}
