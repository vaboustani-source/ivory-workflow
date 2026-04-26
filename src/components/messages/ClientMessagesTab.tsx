import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageThread } from "./MessageThread";

export function ClientMessagesTab({ clientId }: { clientId: string }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id")
        .eq("client_id", clientId)
        .maybeSingle();
      if (cancelled) return;
      setConvId(data?.id ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return <p className="font-serif italic text-primary">Loading conversation…</p>;
  }
  if (!convId) {
    return (
      <div className="bg-surface rounded-lg shadow-soft py-20 text-center">
        <p className="font-serif italic text-2xl text-primary">No conversation found for this client.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg shadow-soft overflow-hidden h-[640px] flex flex-col">
      <MessageThread conversationId={convId} showHeader />
    </div>
  );
}
