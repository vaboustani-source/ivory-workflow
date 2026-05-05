import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { whenLabel, ctaForLabel } from "@/lib/whenLabel";
import { ClipboardList, FileText, Camera, Image as ImageIcon, Receipt, Heart, CalendarClock } from "lucide-react";

type Milestone = {
  id: string;
  title: string;
  due_date: string | null;
  client_facing_label: string | null;
  client_facing_description: string | null;
  client_action_url: string | null;
};

function iconFor(label: string | null, url: string | null) {
  const l = (label ?? "").toLowerCase();
  const u = (url ?? "").toLowerCase();
  if (u.includes("questionnaire") || l.includes("fill out")) return ClipboardList;
  if (u.includes("document") || l.includes("contract")) return FileText;
  if (u.includes("portrait") || l.includes("portrait")) return Camera;
  if (u.includes("gallery") || l.includes("gallery")) return ImageIcon;
  if (u.includes("invoice") || l.includes("retainer") || l.includes("pay")) return Receipt;
  if (l.includes("engagement")) return Heart;
  return CalendarClock;
}

export function MilestoneCards({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<Milestone[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("timeline_milestones")
        .select("id, title, due_date, client_facing_label, client_facing_description, client_action_url, status, is_client_visible")
        .eq("client_id", clientId)
        .eq("is_client_visible", true)
        .neq("status", "complete")
        .not("client_facing_label", "is", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(3);
      if (!cancelled) setItems((data ?? []) as Milestone[]);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">What's next</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((m) => {
          const Icon = iconFor(m.client_facing_label, m.client_action_url);
          const cta = ctaForLabel(m.client_facing_label);
          return (
            <div key={m.id} className="bg-background-alt rounded-md p-5 flex flex-col gap-3 border border-border/60">
              <Icon size={18} className="text-gold" />
              <div className="flex-1">
                <p className="font-serif italic text-[16px] text-primary leading-snug">
                  {m.client_facing_label ?? m.title}
                </p>
                <p className="font-sans italic text-[13px] text-muted-foreground mt-1">
                  {whenLabel(m.due_date)}
                </p>
                {m.client_facing_description && (
                  <p className="text-[13px] text-foreground/80 mt-2 line-clamp-3">
                    {m.client_facing_description}
                  </p>
                )}
              </div>
              {m.client_action_url && (
                <Link
                  to={m.client_action_url as any}
                  className="inline-block bg-magenta text-background text-[12px] px-3 py-1.5 rounded-sm hover:opacity-90 self-start"
                >
                  {cta}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
