import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProposalExperience, type ProposalData, type CoupleLite } from "@/components/ProposalExperience";

// Public proposal page. Leads open this straight from Victoria's email with
// no account or password; the portal login comes after they book.
export const Route = createFileRoute("/p/$token")({
  component: PublicProposalPage,
  head: () => ({
    meta: [
      { title: "Your Proposal — Stories by Victoria" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function PublicProposalPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<{ proposal: ProposalData; client: CoupleLite | null } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");

  const load = async () => {
    try {
      const res = await fetch(`/api/public/proposal/${token}`);
      if (!res.ok) { setState("invalid"); return; }
      setData(await res.json());
      setState("ready");
    } catch {
      setState("invalid");
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`/api/public/proposal/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null))?.error;
      toast.error(
        err === "expired" ? "This proposal has expired. Reach out and Victoria will refresh it."
        : err === "not_open" ? "This proposal is no longer open for changes."
        : "Something went wrong. Please try again.",
      );
      return false;
    }
    return true;
  };

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-serif italic text-xl text-primary">Opening your proposal…</p>
      </div>
    );
  }
  if (state === "invalid" || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6 text-center">
        <div>
          <p className="font-serif italic text-2xl text-primary mb-2">This link isn't valid anymore.</p>
          <p className="text-sm text-muted-foreground">Reach out to Victoria at victoria@victoriaboustani.com and she'll send you a fresh one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-0 md:py-10">
      <div className="max-w-[920px] mx-auto bg-surface md:rounded-xl shadow-elevated overflow-hidden">
        <ProposalExperience
          proposal={data.proposal}
          client={data.client}
          onAccept={async (key, note, addons) => {
            const ok = await post({ action: "accept", option_key: key, note, addons: addons.map((a) => a.label) });
            if (ok) { toast.success("Proposal accepted. Victoria will be in touch within a day."); await load(); }
            return ok;
          }}
          onRequestChange={async (note) => {
            const ok = await post({ action: "change", note });
            if (ok) toast.success("Request sent. Victoria will follow up shortly.");
            return ok;
          }}
        />
      </div>
    </div>
  );
}
