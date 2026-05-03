import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PortalGate } from "@/components/PortalLayout";
import { PortraitSequenceViewer } from "@/components/PortraitSequenceViewer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

export const Route = createFileRoute("/portal/portrait-sequence")({
  component: () => (
    <PortalGate>{({ clientId }) => <PortraitSequencePage clientId={clientId} />}</PortalGate>
  ),
});

function PortraitSequencePage({ clientId }: { clientId: string }) {
  const { profile } = useAuth();
  const [approval, setApproval] = useState<{ id: string; approved_at: string | null; approved_by: string | null } | null>(null);
  const [approverName, setApproverName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("portrait_sequences")
        .select("id, approved_at, approved_by")
        .eq("client_id", clientId)
        .maybeSingle();
      setApproval(data as any);
      if (data?.approved_by) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.approved_by).maybeSingle();
        setApproverName(p?.full_name ?? null);
      }
    })();
  }, [clientId, reload]);

  const approve = async () => {
    if (!approval) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("portrait_sequences")
      .update({ approved_at: new Date().toISOString(), approved_by: profile?.id })
      .eq("id", approval.id);
    if (error) {
      setSubmitting(false);
      toast.error("Couldn't save your approval: " + error.message);
      return;
    }
    await supabase.functions.invoke("notify-portrait-approval", { body: { client_id: clientId } });
    setSubmitting(false);
    toast.success("Approved! Victoria will be notified.");
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif italic text-3xl text-primary">Your portrait sequence</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Generated from your family details. Take a look and let us know if anything looks off.
        </p>
      </div>

      <PortraitSequenceViewer clientId={clientId} editable={false} coupleView={true} />

      {approval && !approval.approved_at && (
        <div className="bg-surface rounded-lg p-6 border border-gold/40 shadow-soft">
          <p className="font-serif italic text-xl text-primary">Does this look right?</p>
          <p className="text-sm text-muted-foreground mt-2">
            If you spot any names or family members you'd like adjusted, message us and Victoria or Dexter will update it.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              onClick={approve}
              disabled={submitting}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm hover:bg-primary/90 inline-flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Yes, this looks great
            </button>
            <Link to="/portal/messages" className="text-xs text-muted-foreground hover:text-magenta underline">
              Have changes? Send us a message
            </Link>
          </div>
        </div>
      )}

      {approval?.approved_at && (
        <div className="bg-surface rounded-lg p-6 border border-sage/50 shadow-soft">
          <p className="font-serif italic text-xl text-primary inline-flex items-center gap-2">
            <Check className="text-sage" size={20} />
            Approved on {new Date(approval.approved_at).toLocaleDateString()}{approverName ? ` by ${approverName}` : ""}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            If anything changes between now and the wedding, just let us know.
          </p>
        </div>
      )}
    </div>
  );
}
