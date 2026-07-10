import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { useAuth } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { X, FileText, Receipt, ScrollText, Check, Loader2 } from "lucide-react";

type SearchSchema = { contract_id?: string; proposal_id?: string; invoice_id?: string };

export const Route = createFileRoute("/portal/documents")({
  validateSearch: (s: Record<string, unknown>): SearchSchema => ({
    contract_id: typeof s.contract_id === "string" ? s.contract_id : undefined,
    proposal_id: typeof s.proposal_id === "string" ? s.proposal_id : undefined,
    invoice_id: typeof s.invoice_id === "string" ? s.invoice_id : undefined,
  }),
  component: () => <PortalGate>{({ clientId, client }) => <PortalDocuments clientId={clientId} client={client} />}</PortalGate>,
});

interface Proposal {
  id: string; status: string; sent_at: string | null; accepted_at: string | null;
  line_items: any; subtotal: number | null; total: number | null; discount: number | null;
  personal_note: string | null; valid_until: string | null;
}
interface Contract {
  id: string; title: string | null; content: string | null; status: string;
  sent_at: string | null; signed_at: string | null;
  signature_required_role: string | null;
  file_url: string | null;
}

interface Invoice {
  id: string; invoice_number: string | null; invoice_type: string | null;
  status: string; amount: number | null; due_date: string | null; paid_at: string | null;
}
interface Signature {
  id: string; contract_id: string; typed_name: string; signed_at: string;
  ip_address: string | null; signed_by_user_id: string;
}

function PortalDocuments({ clientId, client }: { clientId: string; client: any }) {
  const search = useSearch({ from: "/portal/documents" });
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(true);

  const [openContract, setOpenContract] = useState<Contract | null>(null);
  const [openProposal, setOpenProposal] = useState<Proposal | null>(null);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);

  const load = async () => {
    const [p, c, i, s] = await Promise.all([
      supabase.from("proposals").select("id, status, sent_at, accepted_at, line_items, subtotal, total, discount, personal_note, valid_until").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, title, content, status, sent_at, signed_at, signature_required_role, file_url").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase.from("invoices").select("id, invoice_number, invoice_type, status, amount, due_date, paid_at").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase.from("contract_signatures").select("id, contract_id, typed_name, signed_at, ip_address, signed_by_user_id").eq("client_id", clientId),
    ]);
    setProposals((p.data ?? []) as any);
    setContracts((c.data ?? []) as any);
    setInvoices((i.data ?? []) as any);
    setSignatures((s.data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  // Auto-open from query param
  useEffect(() => {
    if (loading) return;
    if (search.contract_id) {
      const c = contracts.find((x) => x.id === search.contract_id);
      if (c) setOpenContract(c);
    } else if (search.proposal_id) {
      const p = proposals.find((x) => x.id === search.proposal_id);
      if (p) setOpenProposal(p);
    } else if (search.invoice_id) {
      const i = invoices.find((x) => x.id === search.invoice_id);
      if (i) setOpenInvoice(i);
    }
    // eslint-disable-next-line
  }, [loading, search.contract_id, search.proposal_id, search.invoice_id]);

  const closeAll = () => {
    setOpenContract(null); setOpenProposal(null); setOpenInvoice(null);
    if (search.contract_id || search.proposal_id || search.invoice_id) {
      navigate({ to: "/portal/documents", search: {} as any });
    }
  };

  const sigsByContract = useMemo(() => {
    const m = new Map<string, Signature[]>();
    signatures.forEach((s) => {
      const arr = m.get(s.contract_id) ?? [];
      arr.push(s); m.set(s.contract_id, arr);
    });
    return m;
  }, [signatures]);

  const isEmpty = !loading && proposals.length === 0 && contracts.length === 0 && invoices.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">Everything we've shared with you.</p>
      </header>

      {loading ? (
        <p className="font-serif italic text-primary">Loading…</p>
      ) : isEmpty ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">Documents will appear here as we share them with you.</p>
        </div>
      ) : (
        <>
          {proposals.length > 0 && (
            <Section title="Proposals">
              {proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} onOpen={() => setOpenProposal(p)} />
              ))}
            </Section>
          )}
          {contracts.length > 0 && (
            <Section title="Contracts">
              {contracts.map((c) => (
                <ContractCard
                  key={c.id}
                  contract={c}
                  signatures={sigsByContract.get(c.id) ?? []}
                  onOpen={() => setOpenContract(c)}
                />
              ))}
            </Section>
          )}
          {invoices.length > 0 && (
            <Section title="Invoices">
              {invoices.map((i) => (
                <InvoiceCard key={i.id} invoice={i} onOpen={() => setOpenInvoice(i)} />
              ))}
            </Section>
          )}
        </>
      )}

      {openProposal && (
        <ProposalModal
          proposal={openProposal}
          onClose={closeAll}
          onAccepted={async () => { await load(); closeAll(); toast.success("Proposal accepted."); }}
        />
      )}
      {openContract && (
        <ContractModal
          contract={openContract}
          signatures={sigsByContract.get(openContract.id) ?? []}
          clientId={clientId}
          client={client}
          onClose={closeAll}
          onSigned={async () => { await load(); }}
        />
      )}
      {openInvoice && (
        <InvoiceModal invoice={openInvoice} onClose={closeAll} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function StatusPill({ status, tone }: { status: string; tone?: "ok" | "warn" | "info" | "muted" }) {
  const cls =
    tone === "ok" ? "bg-sage/20 text-sage" :
    tone === "warn" ? "bg-magenta/15 text-magenta" :
    tone === "info" ? "bg-gold/20 text-gold" :
    "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function proposalTone(s: string): "ok" | "warn" | "info" | "muted" {
  if (s === "accepted") return "ok";
  if (s === "expired" || s === "declined") return "warn";
  if (s === "sent") return "info";
  return "muted";
}
function contractTone(s: string): "ok" | "warn" | "info" | "muted" {
  if (s === "signed") return "ok";
  if (s === "sent") return "info";
  return "muted";
}
function invoiceTone(s: string): "ok" | "warn" | "info" | "muted" {
  if (s === "paid") return "ok";
  if (s === "overdue") return "warn";
  if (s === "sent") return "info";
  return "muted";
}

function ProposalCard({ proposal, onOpen }: { proposal: Proposal; onOpen: () => void }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <ScrollText size={16} className="text-gold" />
          <h3 className="font-serif italic text-xl text-primary">Your proposal</h3>
          <StatusPill status={proposal.status} tone={proposalTone(proposal.status)} />
        </div>
        <p className="text-xs text-muted-foreground">
          {proposal.accepted_at ? `Accepted ${shortDate(proposal.accepted_at)}` : proposal.sent_at ? `Sent ${shortDate(proposal.sent_at)}` : "Draft"}
        </p>
      </div>
      <button
        onClick={onOpen}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 self-start md:self-auto"
      >
        Review proposal
      </button>
    </div>
  );
}

async function openPortalSignedPdf(path: string) {
  const { data, error } = await supabase.storage
    .from("signed-contracts")
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    toast.error(error?.message ?? "Could not open PDF.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function ContractCard({ contract, signatures, onOpen }: { contract: Contract; signatures: Signature[]; onOpen: () => void }) {
  const isUpload = !!contract.file_url;
  const isSigned = contract.status === "signed" || signatures.length > 0;
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <FileText size={16} className="text-gold" />
          <h3 className="font-serif italic text-xl text-primary">{contract.title ?? "Your contract"}</h3>
          <StatusPill status={contract.status} tone={contractTone(contract.status)} />
        </div>
        <p className="text-xs text-muted-foreground">
          {contract.signed_at ? `Signed ${shortDate(contract.signed_at)}` : contract.sent_at ? `Sent ${shortDate(contract.sent_at)}` : "Draft"}
        </p>
      </div>
      <div className="flex gap-2 self-start md:self-auto">
        {isUpload && (
          <button
            onClick={() => contract.file_url && openPortalSignedPdf(contract.file_url)}
            className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10"
          >
            Download PDF
          </button>
        )}
        <button
          onClick={onOpen}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
        >
          {isUpload ? "View" : isSigned ? "View signed contract" : "View contract"}
        </button>
      </div>
    </div>
  );
}


function InvoiceCard({ invoice, onOpen }: { invoice: Invoice; onOpen: () => void }) {
  const label = invoice.invoice_type === "retainer" ? "Retainer invoice"
    : invoice.invoice_type === "final" ? "Final invoice"
    : "Invoice";
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Receipt size={16} className="text-gold" />
          <h3 className="font-serif italic text-xl text-primary">{label}</h3>
          <StatusPill status={invoice.status} tone={invoiceTone(invoice.status)} />
        </div>
        <p className="text-foreground text-2xl font-medium mt-1">
          {invoice.amount != null ? `$${Number(invoice.amount).toLocaleString()}` : "—"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {invoice.paid_at ? `Paid ${shortDate(invoice.paid_at)}` : invoice.due_date ? `Due ${shortDate(invoice.due_date)}` : ""}
        </p>
      </div>
      <button
        onClick={onOpen}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 self-start md:self-auto"
      >
        View invoice
      </button>
    </div>
  );
}

// ============ MODALS ============

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full md:max-w-[800px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden"
      >
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ProposalModal({ proposal, onClose, onAccepted }: { proposal: Proposal; onClose: () => void; onAccepted: () => Promise<void> }) {
  const [accepting, setAccepting] = useState(false);
  const items: Array<{ label: string; amount: number }> = Array.isArray(proposal.line_items) ? proposal.line_items : [];

  const accept = async () => {
    setAccepting(true);
    const { error } = await supabase
      .from("proposals")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", proposal.id);
    if (error) {
      toast.error(error.message);
      setAccepting(false);
      return;
    }
    await onAccepted();
    setAccepting(false);
  };

  const isAccepted = proposal.status === "accepted";

  return (
    <ModalShell title="Your proposal" onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        {proposal.personal_note && (
          <p className="font-serif italic text-lg text-primary/90 whitespace-pre-wrap">{proposal.personal_note}</p>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Investment summary</p>
          <table className="w-full">
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="py-3 text-sm text-foreground">{it.label}</td>
                  <td className="py-3 text-sm text-foreground text-right">${Number(it.amount).toLocaleString()}</td>
                </tr>
              ))}
              {proposal.discount && Number(proposal.discount) > 0 && (
                <tr className="border-b border-border/50">
                  <td className="py-3 text-sm text-muted-foreground">Discount</td>
                  <td className="py-3 text-sm text-muted-foreground text-right">−${Number(proposal.discount).toLocaleString()}</td>
                </tr>
              )}
              <tr>
                <td className="pt-4 font-serif italic text-lg text-primary">Total</td>
                <td className="pt-4 font-serif italic text-lg text-primary text-right">${Number(proposal.total ?? 0).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {proposal.valid_until && (
          <p className="text-xs text-muted-foreground">Valid until {shortDate(proposal.valid_until)}.</p>
        )}

        <div className="border-t border-gold/30 pt-6">
          {isAccepted ? (
            <div className="flex items-center gap-2 text-sage">
              <Check size={16} />
              <span className="font-serif italic text-lg text-primary">Proposal accepted{proposal.accepted_at ? ` on ${shortDate(proposal.accepted_at)}` : ""}.</span>
            </div>
          ) : (
            <button
              onClick={accept}
              disabled={accepting}
              className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {accepting ? "Accepting…" : "I accept this proposal"}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ContractModal({
  contract, signatures, clientId, client, onClose, onSigned,
}: {
  contract: Contract;
  signatures: Signature[];
  clientId: string;
  client: any;
  onClose: () => void;
  onSigned: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [success, setSuccess] = useState(false);
  const [signers, setSigners] = useState<Map<string, { full_name: string | null }>>(new Map());

  // Resolve signer profiles (name display)
  useEffect(() => {
    const ids = signatures.map((s) => s.signed_by_user_id);
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const m = new Map<string, { full_name: string | null }>();
      (data ?? []).forEach((p: any) => m.set(p.id, { full_name: p.full_name }));
      setSigners(m);
    })();
  }, [signatures]);

  const requiresBoth = contract.signature_required_role === "both_partners";
  const alreadySignedByMe = !!profile && signatures.some((s) => s.signed_by_user_id === profile.id);
  const canSign = !alreadySignedByMe && (requiresBoth || signatures.length === 0);

  const handleSign = async () => {
    if (!profile) return;
    if (!typedName.trim() || !agreed) return;
    setSigning(true);
    try {
      // 1. Hash contract content (the version being signed)
      const hash = await sha256Hex(contract.content ?? "");

      // 2. Get IP / user-agent from edge function
      let ip = "unknown";
      let userAgent = navigator.userAgent;
      try {
        const { data } = await supabase.functions.invoke("get-client-ip", { body: {} });
        if (data?.ip) ip = data.ip;
        if (data?.user_agent) userAgent = data.user_agent;
      } catch (e) {
        console.warn("get-client-ip failed; falling back", e);
      }

      // 3. Insert signature
      const { data: sigRow, error: sigErr } = await supabase
        .from("contract_signatures")
        .insert({
          contract_id: contract.id,
          signed_by_user_id: profile.id,
          client_id: clientId,
          typed_name: typedName.trim(),
          agreed_to_terms: true,
          ip_address: ip,
          user_agent: userAgent,
          contract_version_hash: hash,
        })
        .select("id")
        .single();
      if (sigErr || !sigRow) throw sigErr ?? new Error("Failed to record signature");

      // 4. Determine if contract is now fully signed
      const totalSigsAfter = signatures.length + 1;
      const required = requiresBoth ? 2 : 1;
      if (totalSigsAfter >= required) {
        await supabase
          .from("contracts")
          .update({ status: "signed", signed_at: new Date().toISOString() })
          .eq("id", contract.id);
      }

      // Activity log
      try {
        const { logActivity } = await import("@/lib/activityLog");
        await logActivity({
          client_id: clientId,
          action_type: "contract.signed",
          target_type: "contract",
          target_id: contract.id,
          description: `${typedName} signed the contract`,
          client_facing_text: "You signed your contract",
          is_client_visible: true,
        });
      } catch { /* noop */ }

      // 5. Trigger confirmation email
      supabase.functions.invoke("send-contract-receipt", { body: { signature_id: sigRow.id } })
        .catch((e) => console.warn("send-contract-receipt failed", e));

      setSuccess(true);
      await onSigned();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't sign contract.");
    } finally {
      setSigning(false);
    }
  };

  return (
    <ModalShell title={contract.title ?? "Your contract"} onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        {/* Contract body */}
        <article className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:italic prose-headings:text-primary prose-p:text-foreground/90 prose-strong:text-primary">
          {contract.content ? (
            <ReactMarkdown>{contract.content}</ReactMarkdown>
          ) : (
            <p className="font-serif italic text-muted-foreground">Contract content is not available.</p>
          )}
        </article>

        {/* Existing signatures */}
        {signatures.length > 0 && (
          <div className="bg-background-alt rounded-md p-5 border border-gold/30 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signatures</p>
            {signatures.map((s) => (
              <div key={s.id} className="flex items-start gap-3">
                <Check size={16} className="text-sage mt-1 shrink-0" />
                <div>
                  <p className="font-serif italic text-base text-primary">{s.typed_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {signers.get(s.signed_by_user_id)?.full_name ?? "—"} · {new Date(s.signed_at).toLocaleString()} · IP {s.ip_address ?? "—"}
                  </p>
                </div>
              </div>
            ))}
            {requiresBoth && signatures.length < 2 && !alreadySignedByMe && (
              <p className="text-sm font-serif italic text-primary/80 mt-2">Waiting for the second partner to sign.</p>
            )}
          </div>
        )}

        {/* Sign form */}
        {success ? (
          <div className="bg-sage/15 rounded-md p-6 border border-sage text-center">
            <Check size={28} className="text-sage mx-auto mb-2" />
            <p className="font-serif italic text-xl text-primary">Contract signed.</p>
            <p className="text-sm text-muted-foreground mt-2">A copy has been emailed to you.</p>
          </div>
        ) : canSign ? (
          <div className="border-t border-gold/30 pt-6 space-y-4">
            <h3 className="font-serif italic text-xl text-primary">Sign your contract</h3>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type your full legal name</label>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="e.g. Sophia Reyes"
                className="w-full max-w-[360px] px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <p className="text-xs text-muted-foreground max-w-[480px]">
              By typing your name and clicking Sign, you agree to be legally bound by the terms above. Your signature will be recorded with timestamp and IP address.
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
              <span className="text-sm text-foreground">I have read and agree to the terms of this contract.</span>
            </label>
            <button
              onClick={handleSign}
              disabled={!typedName.trim() || !agreed || signing}
              className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-2"
            >
              {signing && <Loader2 size={14} className="animate-spin" />}
              {signing ? "Signing…" : "Sign contract"}
            </button>
          </div>
        ) : alreadySignedByMe && requiresBoth && signatures.length < 2 ? (
          <p className="font-serif italic text-primary/80">You've signed. Waiting for your partner.</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

function InvoiceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const label = invoice.invoice_type === "retainer" ? "Retainer invoice"
    : invoice.invoice_type === "final" ? "Final invoice"
    : "Invoice";
  return (
    <ModalShell title={label} onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-6">
        <div className="flex items-baseline justify-between border-b border-border pb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{invoice.invoice_number ? `Invoice #${invoice.invoice_number}` : "Invoice"}</p>
            <p className="text-3xl font-serif italic text-primary mt-1">${Number(invoice.amount ?? 0).toLocaleString()}</p>
          </div>
          <StatusPill status={invoice.status} tone={invoiceTone(invoice.status)} />
        </div>

        <table className="w-full">
          <tbody>
            <tr className="border-b border-border/50">
              <td className="py-3 text-sm text-foreground">{label}</td>
              <td className="py-3 text-sm text-foreground text-right">${Number(invoice.amount ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="pt-4 font-serif italic text-lg text-primary">Total</td>
              <td className="pt-4 font-serif italic text-lg text-primary text-right">${Number(invoice.amount ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        {invoice.due_date && !invoice.paid_at && (
          <p className="text-sm text-foreground">Due <strong>{shortDate(invoice.due_date)}</strong>.</p>
        )}
        {invoice.paid_at && (
          <div className="bg-sage/15 rounded-md px-4 py-3 inline-flex items-center gap-2">
            <Check size={16} className="text-sage" />
            <span className="text-sm text-foreground">Paid on {shortDate(invoice.paid_at)}</span>
          </div>
        )}
        {!invoice.paid_at && (
          <p className="text-xs text-muted-foreground">
            Payment is processed during your studio review. Please reach out to us if you have any questions.
          </p>
        )}
      </div>
    </ModalShell>
  );
}
