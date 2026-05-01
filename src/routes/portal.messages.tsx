import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { MessageThread } from "@/components/messages/MessageThread";

export const Route = createFileRoute("/portal/messages")({
  component: () => <PortalGate>{({ clientId }) => <PortalMessages clientId={clientId} />}</PortalGate>,
});

function PortalMessages({ clientId }: { clientId: string }) {
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">Your conversation with the studio team.</p>
      </header>

      {loading ? (
        <p className="font-serif italic text-primary">Loading…</p>
      ) : !convId ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">Your conversation will begin here.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg shadow-soft overflow-hidden h-[640px] flex flex-col border-t-2 border-gold">
          <MessageThread conversationId={convId} />
        </div>
      )}
    </div>
  );
}
