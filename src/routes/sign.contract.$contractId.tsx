import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Search = { token?: string };

export const Route = createFileRoute("/sign/contract/$contractId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" ? s.token : undefined,
  }),
  component: SignContractorContract,
});

function SignContractorContract() {
  const { contractId } = useParams({ from: "/sign/contract/$contractId" });
  const { token } = useSearch({ from: "/sign/contract/$contractId" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<{ id: string; title: string; content: string; counter_party_name: string } | null>(null);
  const [alreadySigned, setAlreadySigned] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("Missing access token."); setLoading(false); return; }
    (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-contractor-contract?contract_id=${contractId}&token=${encodeURIComponent(token)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        process(json);
      } catch (e: any) {
        setError(e.message ?? "Failed to load contract");
        setLoading(false);
      }
    })();
    function process(json: any) {
      if (json.error) { setError(json.error); setLoading(false); return; }
      setContract(json.contract);
      setAlreadySigned(!!json.already_signed);
      setTypedName(json.contract?.counter_party_name ?? "");
      setLoading(false);
    }
  }, [contractId, token]);

  const sign = async () => {
    if (!typedName.trim()) return toast.error("Please type your full name");
    if (!agreed) return toast.error("Please agree to the terms");
    setSigning(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sign-contractor-contract`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ contract_id: contractId, token, typed_name: typedName.trim(), agreed_to_terms: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to sign");
      setDone(true);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to sign");
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><p className="font-serif italic text-primary">Loading…</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center bg-background px-4 text-center"><div><h1 className="font-serif italic text-2xl text-primary mb-3">Can't open contract</h1><p className="text-sm text-muted-foreground">{error}</p></div></div>;
  if (!contract) return null;

  if (done || alreadySigned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 text-center">
        <div className="max-w-md">
          <h1 className="font-serif italic text-3xl text-primary">Thank you{typedName ? `, ${typedName.split(" ")[0]}` : ""}.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {alreadySigned && !done ? "This contract has already been signed." : "Your signed contract is on file. We'll be in touch with the next steps."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto bg-surface shadow-elevated rounded-lg overflow-hidden border-t-2 border-gold">
        <header className="px-8 py-6 border-b border-border">
          <h1 className="font-serif italic text-2xl text-primary">{contract.title}</h1>
          <p className="text-xs text-muted-foreground mt-1">For: {contract.counter_party_name}</p>
        </header>
        <div className="px-8 py-6 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground leading-relaxed">
          {contract.content}
        </div>
        <div className="px-8 py-6 border-t border-border bg-background-alt space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">Type your full legal name to sign</label>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span>I have read and agree to the terms of this contract.</span>
          </label>
          <button
            onClick={sign}
            disabled={signing}
            className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {signing ? "Signing…" : "Sign contract"}
          </button>
        </div>
      </div>
    </div>
  );
}
