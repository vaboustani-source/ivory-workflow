import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft } from "lucide-react";
import { editorialDate, parseDateFlexible } from "@/lib/dates";

export const Route = createFileRoute("/studio/queue/hidden")({
  component: HiddenQueuePage,
});

interface HiddenItem {
  id: string;
  title: string;
  due_date: string;
  action_type: string | null;
  client: { couple_name_1: string; couple_name_2: string | null } | null;
}

function HiddenQueuePage() {
  const [items, setItems] = useState<HiddenItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("timeline_milestones")
        .select("id, title, due_date, action_type, client:clients(couple_name_1, couple_name_2)")
        .eq("status", "upcoming")
        .lt("due_date", today)
        .order("due_date", { ascending: false });

      const hidden = (data ?? []).filter((m: any) => {
        const t: string = m.title ?? "";
        const at = m.action_type;
        if (at === "reminder" || at === "system_event" || at === "auto") return true;
        if (/^reminder:/i.test(t) || /^internal:/i.test(t)) return true;
        const sysTitles = new Set([
          "Welcome email", "Full portal unlocked", "Grant inquiry portal access",
          "Client Welcome Guide surfaces", "Engagement branch activates",
          "Album branch activates", "Videography branch activates",
        ]);
        if (sysTitles.has(t)) return true;
        // also include stale (>14 days)
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (m.due_date <= fourteenDaysAgo) return true;
        return false;
      });
      setItems(hidden as HiddenItem[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <Link to="/studio/queue" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-primary mb-6">
        <ArrowLeft size={13} /> Back to queue
      </Link>
      <h1 className="font-serif italic text-4xl text-primary tracking-tight">Hidden items</h1>
      <p className="font-serif italic text-base text-muted-foreground mt-1 mb-8">
        Reminders, system events, internal tasks, and stale milestones — surfaced here so nothing is fully hidden.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nothing hidden right now.</p>
      ) : (
        <ul className="max-w-3xl divide-y divide-border/50 border-t border-b border-border/50">
          {items.map((it) => (
            <li key={it.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{it.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {it.client ? `${it.client.couple_name_1}${it.client.couple_name_2 ? " & " + it.client.couple_name_2 : ""}` : "—"}
                  {" · "}due {editorialDate(parseDateFlexible(it.due_date))}
                  {it.action_type ? ` · ${it.action_type}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
