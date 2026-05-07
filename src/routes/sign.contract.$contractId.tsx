import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { loadBlockContract, submitBlockSigning } from "@/lib/blockSigning.functions";
import { SIGNER_ROLE_LABELS, type SignerRole } from "@/lib/contractBlocks";

type Search = { token?: string };

export const Route = createFileRoute("/sign/contract/$contractId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" ? s.token : undefined,
  }),
  component: SignContract,
});

function SignContract() {
  const { contractId } = useParams({ from: "/sign/contract/$contractId" });
  const { token } = useSearch({ from: "/sign/contract/$contractId" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<any>(null);
  const [data, setData] = useState<any>(null);

  // Legacy state (HTML contracts via existing contractor endpoint)
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);

  const loadFn = useServerFn(loadBlockContract);
  const submitFn = useServerFn(submitBlockSigning);

  useEffect(() => {
    if (!token) { setError("Missing access token."); setLoading(false); return; }
    (async () => {
      // Try block-based first
      try {
        const json = await loadFn({ data: { contractId, token } });
        if (json?.contract?.is_block_based) { setData(json); setLoading(false); return; }
      } catch { /* fall through to legacy */ }
      // Legacy contractor signing endpoint
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-contractor-contract?contract_id=${contractId}&token=${encodeURIComponent(token)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setLegacy(json);
        setTypedName(json.contract?.counter_party_name ?? "");
      } catch (e: any) {
        setError(e.message ?? "Failed to load contract");
      }
      setLoading(false);
    })();
  }, [contractId, token, loadFn]);

  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered><h1 className="font-serif italic text-2xl text-primary mb-3">Can't open contract</h1><p className="text-sm text-muted-foreground">{error}</p></Centered>;

  if (data) {
    return <BlockBasedSign data={data} contractId={contractId} token={token!} submitFn={submitFn} />;
  }

  // ===== Legacy HTML signing (contractor) =====
  if (!legacy) return null;
  const alreadySigned = !!legacy.already_signed;
  const contract = legacy.contract;
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
    } catch (e: any) { toast.error(e.message ?? "Failed to sign"); }
    finally { setSigning(false); }
  };

  if (done || alreadySigned) {
    return <Centered>
      <h1 className="font-serif italic text-3xl text-primary">Thank you{typedName ? `, ${typedName.split(" ")[0]}` : ""}.</h1>
      <p className="mt-3 text-sm text-muted-foreground">{alreadySigned && !done ? "This contract has already been signed." : "Your signed contract is on file."}</p>
    </Centered>;
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto bg-surface shadow-elevated rounded-lg overflow-hidden border-t-2 border-gold">
        <header className="px-8 py-6 border-b border-border">
          <h1 className="font-serif italic text-2xl text-primary">{contract.title}</h1>
          <p className="text-xs text-muted-foreground mt-1">For: {contract.counter_party_name}</p>
        </header>
        <div className="px-8 py-6 max-h-[60vh] overflow-y-auto prose prose-sm max-w-none text-sm text-foreground leading-relaxed" dangerouslySetInnerHTML={{ __html: contract.content }} />
        <div className="px-8 py-6 border-t border-border bg-background-alt space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">Type your full legal name to sign</label>
            <input value={typedName} onChange={(e) => setTypedName(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span>I have read and agree to the terms of this contract.</span>
          </label>
          <button onClick={sign} disabled={signing} className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-60">
            {signing ? "Signing…" : "Sign contract"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-background px-4 text-center"><div className="max-w-md">{children}</div></div>;
}

function BlockBasedSign({ data, contractId, token, submitFn }: { data: any; contractId: string; token: string; submitFn: any }) {
  const { contract, blocks, signer, signers } = data;
  const myRole = signer.signer_role as SignerRole;
  const [responses, setResponses] = useState<Record<string, { text?: string; data?: any }>>(() => {
    const init: Record<string, any> = {};
    for (const r of data.responses ?? []) {
      if (r.signer_role === myRole) init[r.contract_block_id] = { text: r.response_text, data: r.response_data };
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(!!signer.signed_at);

  const setResp = (id: string, patch: { text?: string; data?: any }) =>
    setResponses((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const myInteractive = useMemo(() => blocks.filter((b: any) => isInteractive(b.block_type) && (!b.signer_role || b.signer_role === myRole)), [blocks, myRole]);

  const submit = async () => {
    // Validate required
    for (const b of myInteractive) {
      if (!b.config?.required) continue;
      const r = responses[b.id];
      const hasText = r?.text && String(r.text).trim();
      const hasData = r?.data && (Array.isArray(r.data) ? r.data.length > 0 : Object.keys(r.data).length > 0);
      if (!hasText && !hasData) {
        toast.error(`Please complete: ${b.config?.label || b.block_type}`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = myInteractive.map((b: any) => {
        const r = responses[b.id] ?? {};
        return { contract_block_id: b.id, response_text: r.text ?? null, response_data: r.data ?? {} };
      });
      const result = await submitFn({ data: { contractId, token, responses: payload } });
      setDone(true);
      if (result?.all_signed) toast.success("All signers complete — contract is fully signed.");
      else toast.success("Your signature has been recorded.");
    } catch (e: any) {
      toast.error(e.message ?? "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return <Centered>
      <h1 className="font-serif italic text-3xl text-primary">Thank you{signer.name ? `, ${signer.name.split(" ")[0]}` : ""}.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Your signature has been recorded.</p>
      <SignerStatus signers={signers.map((s: any) => s.id === signer.id ? { ...s, signed_at: new Date().toISOString() } : s)} />
    </Centered>;
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-3xl mx-auto bg-surface shadow-elevated rounded-lg overflow-hidden border-t-2 border-gold">
        <header className="px-8 py-6 border-b border-border">
          <h1 className="font-serif italic text-2xl text-primary">{contract.title}</h1>
          <p className="text-xs text-muted-foreground mt-1">Signing as: {signer.name || SIGNER_ROLE_LABELS[myRole]}</p>
        </header>
        <div className="px-8 py-6 space-y-5">
          {blocks.map((b: any) => (
            <BlockRender
              key={b.id}
              block={b}
              myRole={myRole}
              signers={signers}
              value={responses[b.id]}
              onChange={(patch) => setResp(b.id, patch)}
            />
          ))}
        </div>
        <div className="px-8 py-6 border-t border-border bg-background-alt flex items-center justify-between">
          <SignerStatus signers={signers} />
          <button onClick={submit} disabled={submitting} className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-60">
            {submitting ? "Submitting…" : "Submit & sign"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignerStatus({ signers }: { signers: any[] }) {
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      {signers.map((s) => (
        <div key={s.id}>
          {s.name || SIGNER_ROLE_LABELS[s.signer_role as SignerRole] || s.signer_role}:{" "}
          {s.signed_at ? <span className="text-sage">✓ signed</span> : <span>awaiting</span>}
        </div>
      ))}
    </div>
  );
}

function isInteractive(t: string): boolean {
  return ["short_answer", "free_response", "date_select", "initials", "signature", "dropdown", "checkboxes", "multiple_choice"].includes(t);
}

function BlockRender({ block, myRole, signers, value, onChange }: { block: any; myRole: SignerRole; signers: any[]; value: any; onChange: (p: { text?: string; data?: any }) => void }) {
  const c = block.config ?? {};
  const t = block.block_type;

  // Display blocks
  if (t === "text_box") return <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: block.content || c.content || "" }} />;
  if (t === "image") return c.url ? <img src={c.url} alt={c.alt || ""} style={{ width: c.width ? `${c.width}px` : "100%" }} /> : null;
  if (t === "divider") return <hr className={c.style === "dashed" ? "border-dashed border-border" : c.style === "gold" ? "border-gold" : "border-border"} />;
  if (t === "spacer") {
    const h = c.size === "small" ? 12 : c.size === "large" ? 48 : 24;
    return <div style={{ height: h }} />;
  }

  // Interactive — for OTHER signer, show read-only awaiting state
  if ((t === "initials" || t === "signature") && c.signer_role && c.signer_role !== myRole) {
    const target = signers.find((s: any) => s.signer_role === c.signer_role);
    return (
      <div className="border border-dashed border-border rounded-md p-3 text-xs text-muted-foreground italic bg-background-alt">
        {target?.signed_at ? <>✓ {target?.name || SIGNER_ROLE_LABELS[c.signer_role as SignerRole]} signed</> : <>Awaiting {target?.name || SIGNER_ROLE_LABELS[c.signer_role as SignerRole]}'s {t === "initials" ? "initials" : "signature"}</>}
        {c.label && <p className="mt-1">{c.label}</p>}
      </div>
    );
  }

  const label = (
    <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-1.5">
      {c.label}{c.required && <span className="text-magenta"> *</span>}
    </label>
  );
  const helper = c.helper ? <p className="text-[11px] text-muted-foreground mt-1">{c.helper}</p> : null;

  if (t === "short_answer") return <div>{label}<input value={value?.text ?? ""} placeholder={c.placeholder} onChange={(e) => onChange({ text: e.target.value })} className="input" />{helper}</div>;
  if (t === "free_response") return <div>{label}<textarea value={value?.text ?? ""} placeholder={c.placeholder} maxLength={c.max_length} onChange={(e) => onChange({ text: e.target.value })} className="input min-h-[100px]" />{helper}</div>;
  if (t === "date_select") return <div>{label}<input type="date" value={value?.text ?? ""} min={c.min_date} max={c.max_date} onChange={(e) => onChange({ text: e.target.value })} className="input" />{helper}</div>;

  if (t === "initials") return (
    <div className="border border-gold/40 bg-gold/5 rounded-md p-3">
      <p className="text-sm text-foreground mb-2">{c.label}{c.required && <span className="text-magenta"> *</span>}</p>
      <input value={value?.text ?? ""} placeholder="Your initials" maxLength={4} onChange={(e) => onChange({ text: e.target.value.toUpperCase() })} className="input w-32 font-serif italic text-lg" />
    </div>
  );

  if (t === "signature") return (
    <div className="border border-gold/40 bg-gold/5 rounded-md p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signature{c.required && <span className="text-magenta"> *</span>}</p>
      <input
        value={value?.text ?? ""}
        placeholder="Type your full legal name to sign"
        onChange={(e) => onChange({ text: e.target.value, data: { typed_name: e.target.value, signed_date: c.show_date ? new Date().toISOString() : undefined } })}
        className="input font-serif italic text-xl text-primary"
      />
      {c.show_date && <p className="text-xs text-muted-foreground">Date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>}
    </div>
  );

  if (t === "dropdown") return (
    <div>{label}
      <select value={value?.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} className="input">
        <option value="">— Select —</option>
        {(c.options ?? []).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {helper}
    </div>
  );

  if (t === "multiple_choice") return (
    <div>{label}
      <div className="space-y-1.5">
        {(c.options ?? []).map((o: any) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={value?.text === o.value} onChange={() => onChange({ text: o.value })} /> {o.label}
          </label>
        ))}
      </div>
      {helper}
    </div>
  );

  if (t === "checkboxes") {
    const selected: string[] = Array.isArray(value?.data) ? value.data : [];
    const toggle = (v: string) => {
      const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
      onChange({ data: next, text: next.join(",") });
    };
    return (
      <div>{label}
        <div className="space-y-1.5">
          {(c.options ?? []).map((o: any) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
            </label>
          ))}
        </div>
        {helper}
      </div>
    );
  }

  return null;
}
