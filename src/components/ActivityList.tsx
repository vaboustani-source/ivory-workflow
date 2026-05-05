import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ClipboardList, FileText, Camera, Image as ImageIcon, Receipt, Calendar,
  CheckCircle2, MessageSquare, Activity as ActivityIcon,
} from "lucide-react";

type Row = {
  id: string;
  action_type: string | null;
  description: string | null;
  client_facing_text: string | null;
  is_client_visible: boolean;
  created_at: string;
};

function iconFor(action: string | null) {
  const a = (action ?? "").toLowerCase();
  if (a.startsWith("questionnaire")) return ClipboardList;
  if (a.startsWith("contract")) return FileText;
  if (a.startsWith("portrait_sequence")) return Camera;
  if (a.startsWith("photography_timeline")) return Calendar;
  if (a.startsWith("gallery")) return ImageIcon;
  if (a.startsWith("invoice") || a.includes("retainer")) return Receipt;
  if (a.startsWith("milestone")) return CheckCircle2;
  if (a.startsWith("message")) return MessageSquare;
  return ActivityIcon;
}

function dayHeader(iso: string) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: target.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ActivityList({ clientId, mode }: { clientId: string; mode: "couple" | "studio" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("activity_log")
        .select("id, action_type, description, client_facing_text, is_client_visible, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(limit + 1);
      if (mode === "couple") q = q.eq("is_client_visible", true);
      const { data } = await q;
      if (cancelled) return;
      const list = (data ?? []) as Row[];
      setHasMore(list.length > limit);
      setRows(list.slice(0, limit));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, mode, limit]);

  if (loading) return <p className="font-serif italic text-primary">Loading…</p>;

  if (rows.length === 0) {
    return (
      <p className="font-serif italic text-lg text-muted-foreground">Nothing has happened yet.</p>
    );
  }

  // group by day
  const groups: Record<string, Row[]> = {};
  for (const r of rows) {
    const k = dayHeader(r.created_at);
    (groups[k] ??= []).push(r);
  }

  return (
    <div className="space-y-8">
      {Object.entries(groups).map(([day, items]) => (
        <div key={day}>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{day}</p>
          <ul className="space-y-2">
            {items.map((r) => {
              const Icon = iconFor(r.action_type);
              const main = mode === "couple"
                ? (r.client_facing_text ?? r.description ?? "Activity")
                : (r.description ?? r.client_facing_text ?? "Activity");
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 px-3 py-3 rounded-md hover:bg-background-alt/60 transition-colors"
                >
                  <Icon size={16} className="text-gold mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif italic text-[15px] text-foreground leading-snug">{main}</p>
                    {mode === "studio" && r.is_client_visible && r.client_facing_text && (
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        Couple sees: {r.client_facing_text}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 mt-1">{relTime(r.created_at)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {hasMore && (
        <div className="text-center">
          <button
            onClick={() => setLimit((l) => l + 50)}
            className="text-sm text-primary underline hover:no-underline"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
