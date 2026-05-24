import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/dates";

interface PendingChange {
  id: string;
  proposed_by_role: string;
  change_type: string;
  payload: { resolved_description?: string; resolved_line_total_cents?: number };
  created_at: string;
  proposer?: { full_name: string | null } | null;
}

export function PendingPricingChangesBanner({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<PendingChange[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("pending_changes")
      .select("id,proposed_by_role,change_type,payload,created_at,proposer:profiles!pending_changes_proposed_by_fkey(full_name)")
      .eq("client_id", clientId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setItems((data ?? []) as unknown as PendingChange[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`pending-${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_changes", filter: `client_id=eq.${clientId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-md border border-gold/40 bg-gold/10 p-4 flex items-start gap-3">
      <AlertCircle size={18} className="text-gold shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary">
          {items.length} pending pricing change{items.length === 1 ? "" : "s"} awaiting owner approval
        </p>
        <ul className="mt-2 space-y-1">
          {items.map((p) => (
            <li key={p.id} className="text-xs text-foreground">
              <span className="font-medium">
                {p.payload?.resolved_description ?? "(item)"}
              </span>
              {typeof p.payload?.resolved_line_total_cents === "number" && (
                <span className="text-muted-foreground ml-1">
                  ${(p.payload.resolved_line_total_cents / 100).toFixed(2)}
                </span>
              )}
              <span className="text-muted-foreground ml-2">
                — proposed by {p.proposer?.full_name ?? "manager"} {relativeTime(p.created_at)}
              </span>
            </li>
          ))}
        </ul>
        <a href="/studio/approval-queue?tab=pricing" className="inline-block mt-2 text-xs text-gold hover:underline">
          Review in Approval Queue →
        </a>
      </div>
    </div>
  );
}
