import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/dates";
import ReactMarkdown from "react-markdown";
import { X, FileText, Receipt, ScrollText, Plus, Pencil, Download, Upload } from "lucide-react";
import { ContractEditorModal } from "./ContractEditorModal";
import { UploadSignedContractModal, openSignedContractPdf } from "./UploadSignedContractModal";
import { useAuth } from "@/lib/auth";

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
  contract_kind: string;
}

interface Invoice {
  id: string; invoice_number: string | null; invoice_type: string | null;
  status: string; amount: number | null; due_date: string | null; paid_at: string | null;
}
interface Signature {
  id: string; contract_id: string; typed_name: string; signed_at: string;
  ip_address: string | null; user_agent: string | null; signed_by_user_id: string;
  contract_version_hash: string;
}

function tonePill(tone: "ok" | "warn" | "info" | "muted") {
  return tone === "ok" ? "bg-sage/20 text-sage"
    : tone === "warn" ? "bg-magenta/15 text-magenta"
    : tone === "info" ? "bg-gold/20 text-gold"
    : "bg-muted text-muted-foreground";
}
function StatusPill({ status, tone }: { status: string; tone: "ok" | "warn" | "info" | "muted" }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${tonePill(tone)}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
const proposalTone = (s: string) => s === "accepted" ? "ok" as const : (s === "expired" || s === "declined") ? "warn" as const : s === "sent" ? "info" as const : "muted" as const;
const contractTone = (s: string) => s === "signed" ? "ok" as const : s === "sent" ? "info" as const : "muted" as const;
const invoiceTone = (s: string) => s === "paid" ? "ok" as const : s === "overdue" ? "warn" as const : s === "sent" ? "info" as const : "muted" as const;

export function StudioDocumentsTab({ clientId, openContractId }: { clientId: string; openContractId?: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [clientLite, setClientLite] = useState<{ id: string; couple_name_1: string; couple_name_2: string | null; wedding_date: string | null; venue_name: string | null; primary_email: string | null; primary_client_last_name: string | null; alternate_client_last_name: string | null; primary_client_phone: string | null; alternate_client_phone: string | null; shared_street_address: string | null; shared_city: string | null; shared_state: string | null; shared_zipcode: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const [openContract, setOpenContract] = useState<Contract | null>(null);
  const [openProposal, setOpenProposal] = useState<Proposal | null>(null);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);
  const [editorContractId, setEditorContractId] = useState<string | null>(null);
  const [creatingNewContract, setCreatingNewContract] = useState(false);
  const [uploadingSigned, setUploadingSigned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { roles } = useAuth();
  const canUploadSigned = roles.includes("owner") || roles.includes("studio_manager");


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, c, i, s, cl] = await Promise.all([
        supabase.from("proposals").select("id, status, sent_at, accepted_at, line_items, subtotal, total, discount, personal_note, valid_until").eq("client_id", clientId).order("created_at", { ascending: false }),
        supabase.from("contracts").select("id, title, content, status, sent_at, signed_at, signature_required_role, file_url, contract_kind").eq("client_id", clientId).order("created_at", { ascending: false }),
        supabase.from("invoices").select("id, invoice_number, invoice_type, status, amount, due_date, paid_at").eq("client_id", clientId).order("created_at", { ascending: false }),
        supabase.from("contract_signatures").select("id, contract_id, typed_name, signed_at, ip_address, user_agent, signed_by_user_id, contract_version_hash").eq("client_id", clientId),
        supabase.from("clients").select("id, couple_name_1, couple_name_2, wedding_date, venue_name, primary_email, primary_client_last_name, alternate_client_last_name, primary_client_phone, alternate_client_phone, shared_street_address, shared_city, shared_state, shared_zipcode").eq("id", clientId).maybeSingle(),
      ]);
      if (cancelled) return;
      setProposals((p.data ?? []) as any);
      setContracts((c.data ?? []) as any);
      setInvoices((i.data ?? []) as any);
      setSignatures((s.data ?? []) as any);
      setClientLite((cl.data ?? null) as any);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, reloadKey]);

  // Auto-open via deep link
  useEffect(() => {
    if (loading || !openContractId) return;
    const c = contracts.find((x) => x.id === openContractId);
    if (c) setOpenContract(c);
  }, [loading, openContractId, contracts]);

  const sigsByContract = useMemo(() => {
    const m = new Map<string, Signature[]>();
    signatures.forEach((s) => {
      const arr = m.get(s.contract_id) ?? [];
      arr.push(s); m.set(s.contract_id, arr);
    });
    return m;
  }, [signatures]);

  const refresh = () => setReloadKey((k) => k + 1);

  if (loading) return <p className="font-serif italic text-primary">Loading…</p>;

  const isEmpty = proposals.length === 0 && contracts.length === 0 && invoices.length === 0;

  return (
    <div className="space-y-8">
      {isEmpty ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No documents yet.</p>
          <p className="text-sm text-muted-foreground mt-2">Send the first contract to get started.</p>
          {clientLite && (
            <button
              onClick={() => setCreatingNewContract(true)}
              className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
            >
              <Plus size={14} /> New contract
            </button>
          )}
        </div>
      ) : (
        <>
          {proposals.length > 0 && (
            <Section title="Proposals">
              {proposals.map((p) => (
                <Row key={p.id} icon={<ScrollText size={16} className="text-gold" />}
                  title="Proposal" pill={<StatusPill status={p.status} tone={proposalTone(p.status)} />}
                  meta={p.accepted_at ? `Accepted ${shortDate(p.accepted_at)}` : p.sent_at ? `Sent ${shortDate(p.sent_at)}` : "Draft"}
                  extra={p.total != null ? `Total: $${Number(p.total).toLocaleString()}` : null}
                  onView={() => setOpenProposal(p)} />
              ))}
            </Section>
          )}
          <Section
            title="Contracts"
            action={
              clientLite && (
                <div className="flex items-center gap-3">
                  {canUploadSigned && (
                    <button
                      onClick={() => setUploadingSigned(true)}
                      className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider"
                    >
                      <Upload size={12} /> Upload signed contract
                    </button>
                  )}
                  <button
                    onClick={() => setCreatingNewContract(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider"
                  >
                    <Plus size={12} /> New contract
                  </button>
                </div>
              )
            }
          >

            {contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No contracts yet.</p>
            ) : contracts.map((c) => {
              const sigs = sigsByContract.get(c.id) ?? [];
              const required = c.signature_required_role === "both_partners" ? 2 : 1;
              const isUpload = !!c.file_url;
              return (
                <Row key={c.id} icon={<FileText size={16} className="text-gold" />}
                  title={c.title ?? "Contract"} pill={<StatusPill status={c.status} tone={contractTone(c.status)} />}
                  meta={c.signed_at ? `Signed ${shortDate(c.signed_at)}` : c.sent_at ? `Sent ${shortDate(c.sent_at)}` : "Draft"}
                  extra={
                    isUpload ? (
                      <span className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-gold"><Upload size={12} /> Uploaded PDF</span>
                        <span className="text-muted-foreground">·</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (c.file_url) openSignedContractPdf(c.file_url); }}
                          className="inline-flex items-center gap-1 text-gold hover:text-primary"
                        >
                          <Download size={12} /> Download PDF
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-3">
                        <span>{c.signature_required_role === "both_partners" ? "Both partners required" : "Single signer"}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{sigs.length} of {required} signed</span>
                      </span>
                    )
                  }
                  onView={() => setOpenContract(c)} />
              );
            })}

          </Section>
          {invoices.length > 0 && (
            <Section title="Invoices">
              {invoices.map((i) => (
                <Row key={i.id} icon={<Receipt size={16} className="text-gold" />}
                  title={i.invoice_type === "retainer" ? "Retainer invoice" : i.invoice_type === "final" ? "Final invoice" : "Invoice"}
                  pill={<StatusPill status={i.status} tone={invoiceTone(i.status)} />}
                  meta={i.paid_at ? `Paid ${shortDate(i.paid_at)}` : i.due_date ? `Due ${shortDate(i.due_date)}` : ""}
                  extra={i.amount != null ? `$${Number(i.amount).toLocaleString()}` : "—"}
                  onView={() => setOpenInvoice(i)} />
              ))}
            </Section>
          )}
        </>
      )}

      {openProposal && <ProposalModal proposal={openProposal} onClose={() => setOpenProposal(null)} />}
      {openContract && (
        <ContractModal
          contract={openContract}
          signatures={sigsByContract.get(openContract.id) ?? []}
          onClose={() => setOpenContract(null)}
          onEdit={openContract.status !== "signed" ? () => {
            setEditorContractId(openContract.id);
            setOpenContract(null);
          } : undefined}
        />
      )}
      {openInvoice && <InvoiceModal invoice={openInvoice} onClose={() => setOpenInvoice(null)} />}
      {clientLite && creatingNewContract && (
        <ContractEditorModal
          client={clientLite}
          onClose={() => setCreatingNewContract(false)}
          onSaved={refresh}
        />
      )}
      {clientLite && editorContractId && (
        <ContractEditorModal
          client={clientLite}
          existingContractId={editorContractId}
          onClose={() => setEditorContractId(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ icon, title, pill, meta, extra, onView }: {
  icon: React.ReactNode; title: string; pill: React.ReactNode; meta: React.ReactNode; extra?: React.ReactNode; onView: () => void;
}) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1">
          {icon}
          <h3 className="font-serif italic text-xl text-primary truncate">{title}</h3>
          {pill}
        </div>
        <p className="text-xs text-muted-foreground">{meta}</p>
        {extra && <p className="text-sm text-foreground mt-1">{extra}</p>}
      </div>
      <button onClick={onView} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 self-start md:self-auto">View</button>
    </div>
  );
}

// ============= MODALS =============

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[800px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ProposalModal({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const items: Array<{ label: string; amount: number }> = Array.isArray(proposal.line_items) ? proposal.line_items : [];
  return (
    <ModalShell title="Proposal" onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>Status: <span className="text-foreground capitalize">{proposal.status.replace(/_/g, " ")}</span></span>
          {proposal.sent_at && <span>Sent {shortDate(proposal.sent_at)}</span>}
          {proposal.accepted_at && <span>Accepted {shortDate(proposal.accepted_at)}</span>}
          {proposal.valid_until && <span>Valid until {shortDate(proposal.valid_until)}</span>}
        </div>
        {proposal.personal_note && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Personal note</p>
            <p className="font-serif italic text-lg text-primary/90 whitespace-pre-wrap">{proposal.personal_note}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Line items</p>
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
      </div>
    </ModalShell>
  );
}

function ContractModal({ contract, signatures, onClose, onEdit }: { contract: Contract; signatures: Signature[]; onClose: () => void; onEdit?: () => void }) {
  const [signers, setSigners] = useState<Map<string, { full_name: string | null }>>(new Map());

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

  const required = contract.signature_required_role === "both_partners" ? 2 : 1;
  const isAwaiting = signatures.length < required;

  return (
    <ModalShell title={contract.title ?? "Contract"} onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
            <span>Status: <span className="text-foreground capitalize">{contract.status.replace(/_/g, " ")}</span></span>
            {contract.sent_at && <span>Sent {shortDate(contract.sent_at)}</span>}
            {contract.signed_at && <span>Signed {shortDate(contract.signed_at)}</span>}
            <span>{contract.signature_required_role === "both_partners" ? "Both partners required" : "Single signer"}</span>
          </div>
          {onEdit && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 border border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>

        <div className="prose prose-sm max-w-none font-serif text-foreground">
          {contract.content ? <ReactMarkdown>{contract.content}</ReactMarkdown> : <p className="text-muted-foreground italic">No content.</p>}
        </div>

        <div className="border-t border-gold/30 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Signatures ({signatures.length} of {required})</p>
          {signatures.length === 0 ? (
            <p className="font-serif italic text-gold">Awaiting signature.</p>
          ) : (
            <div className="space-y-4">
              {signatures.map((s) => (
                <div key={s.id} className="bg-background-alt/40 rounded-md p-4 border border-border">
                  <p className="font-serif italic text-lg text-primary">{s.typed_name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {signers.get(s.signed_by_user_id)?.full_name ?? "—"} · Signed {new Date(s.signed_at).toLocaleString()}
                  </p>
                  <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5 font-mono">
                    {s.ip_address && <p>IP: {s.ip_address}</p>}
                    <p className="break-all">Hash: {s.contract_version_hash}</p>
                  </div>
                </div>
              ))}
              {isAwaiting && <p className="font-serif italic text-gold text-sm">Still awaiting {required - signatures.length} more signature{required - signatures.length === 1 ? "" : "s"}.</p>}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function InvoiceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  return (
    <ModalShell title={invoice.invoice_type === "retainer" ? "Retainer invoice" : invoice.invoice_type === "final" ? "Final invoice" : "Invoice"} onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-6">
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>Status: <span className="text-foreground capitalize">{invoice.status.replace(/_/g, " ")}</span></span>
          {invoice.invoice_number && <span>#{invoice.invoice_number}</span>}
          {invoice.due_date && <span>Due {shortDate(invoice.due_date)}</span>}
          {invoice.paid_at && <span>Paid {shortDate(invoice.paid_at)}</span>}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Amount</p>
          <p className="font-serif italic text-4xl text-primary mt-1">{invoice.amount != null ? `$${Number(invoice.amount).toLocaleString()}` : "—"}</p>
        </div>
      </div>
    </ModalShell>
  );
}
