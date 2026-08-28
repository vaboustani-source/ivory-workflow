import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/dates";
import ReactMarkdown from "react-markdown";
import { X, FileText, Receipt, ScrollText, Plus, Pencil, Download, Upload } from "lucide-react";
import { ContractEditorModal } from "./ContractEditorModal";
import { UploadSignedContractModal, openSignedContractPdf } from "./UploadSignedContractModal";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

interface ProposalOption {
  key: string; name: string; description?: string;
  line_items: Array<{ label: string; amount: number }>;
  subtotal?: number; discount?: number; total: number;
}
interface Proposal {
  id: string; status: string; sent_at: string | null; accepted_at: string | null;
  line_items: any; subtotal: number | null; total: number | null; discount: number | null;
  personal_note: string | null; valid_until: string | null;
  options: ProposalOption[] | null; selected_option: string | null;
  change_request: string | null; change_requested_at: string | null;
  acceptance_note: string | null;
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
  const [editingProposal, setEditingProposal] = useState<Proposal | "new" | null>(null);
  const [uploadingSigned, setUploadingSigned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { roles } = useAuth();
  const canUploadSigned = roles.includes("owner") || roles.includes("studio_manager");


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, c, i, s, cl] = await Promise.all([
        supabase.from("proposals").select("id, status, sent_at, accepted_at, line_items, subtotal, total, discount, personal_note, valid_until, options, selected_option, change_request, change_requested_at, acceptance_note").eq("client_id", clientId).order("created_at", { ascending: false }),
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
          <p className="text-sm text-muted-foreground mt-2">Start with a proposal, or send the first contract.</p>
          {clientLite && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => setEditingProposal("new")}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
              >
                <Plus size={14} /> New proposal
              </button>
              <button
                onClick={() => setCreatingNewContract(true)}
                className="inline-flex items-center gap-2 border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10"
              >
                <Plus size={14} /> New contract
              </button>
              {canUploadSigned && (
                <button
                  onClick={() => setUploadingSigned(true)}
                  className="inline-flex items-center gap-2 border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10"
                >
                  <Upload size={14} /> Upload signed contract
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <Section
            title="Proposals"
            action={
              clientLite && (
                <button
                  onClick={() => setEditingProposal("new")}
                  className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider"
                >
                  <Plus size={12} /> New proposal
                </button>
              )
            }
          >
              {proposals.map((p) => {
                const selectedOpt = (p.options ?? []).find((o) => o.key === p.selected_option);
                const pendingChange = !!p.change_request && p.status !== "accepted";
                return (
                  <Row key={p.id} icon={<ScrollText size={16} className="text-gold" />}
                    title="Proposal"
                    pill={
                      <span className="inline-flex items-center gap-2">
                        <StatusPill status={p.status} tone={proposalTone(p.status)} />
                        {pendingChange && <StatusPill status="change requested" tone="warn" />}
                      </span>
                    }
                    meta={p.accepted_at ? `Accepted ${shortDate(p.accepted_at)}${selectedOpt ? ` — "${selectedOpt.name}"` : ""}` : p.sent_at ? `Sent ${shortDate(p.sent_at)}` : "Draft"}
                    extra={
                      p.status === "accepted" && p.total != null
                        ? `Total: $${Number(p.total).toLocaleString()}`
                        : (p.options?.length ?? 0) > 0
                          ? (p.options ?? []).map((o) => `${o.name}: $${Number(o.total).toLocaleString()}`).join(" · ")
                          : p.total != null ? `Total: $${Number(p.total).toLocaleString()}` : null
                    }
                    onView={() => setOpenProposal(p)} />
                );
              })}
              {proposals.length === 0 && (
                <p className="text-sm text-muted-foreground">No proposal yet. "New proposal" starts from your two-option template.</p>
              )}
          </Section>
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

      {openProposal && (
        <ProposalModal
          proposal={openProposal}
          onClose={() => setOpenProposal(null)}
          onEdit={openProposal.status !== "accepted" ? () => { setEditingProposal(openProposal); setOpenProposal(null); } : undefined}
        />
      )}
      {editingProposal && clientLite && (
        <ProposalEditorModal
          clientId={clientId}
          client={clientLite}
          proposal={editingProposal === "new" ? null : editingProposal}
          onClose={() => setEditingProposal(null)}
          onSaved={() => { setEditingProposal(null); refresh(); }}
        />
      )}
      {openContract && (
        <ContractModal
          contract={openContract}
          signatures={sigsByContract.get(openContract.id) ?? []}
          onClose={() => setOpenContract(null)}
          onEdit={openContract.status !== "signed" && !openContract.file_url ? () => {
            setEditorContractId(openContract.id);
            setOpenContract(null);
          } : undefined}
        />
      )}
      {uploadingSigned && (
        <UploadSignedContractModal
          clientId={clientId}
          onClose={() => setUploadingSigned(false)}
          onSaved={refresh}
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

function ProposalModal({ proposal, onClose, onEdit }: { proposal: Proposal; onClose: () => void; onEdit?: () => void }) {
  const items: Array<{ label: string; amount: number }> = Array.isArray(proposal.line_items) ? proposal.line_items : [];
  const options: ProposalOption[] = Array.isArray(proposal.options) ? proposal.options : [];
  return (
    <ModalShell title="Proposal" onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
            <span>Status: <span className="text-foreground capitalize">{proposal.status.replace(/_/g, " ")}</span></span>
            {proposal.sent_at && <span>Sent {shortDate(proposal.sent_at)}</span>}
            {proposal.accepted_at && <span>Accepted {shortDate(proposal.accepted_at)}</span>}
            {proposal.valid_until && <span>Valid until {shortDate(proposal.valid_until)}</span>}
          </div>
          {onEdit && (
            <button onClick={onEdit} className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider">
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
        {proposal.acceptance_note && (
          <div className="rounded-md border border-sage/40 bg-sage/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-sage mb-1">Their note on acceptance</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{proposal.acceptance_note}</p>
          </div>
        )}
        {proposal.change_request && (
          <div className="rounded-md border border-magenta/40 bg-magenta/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-magenta mb-1">
              Change requested{proposal.change_requested_at ? ` · ${shortDate(proposal.change_requested_at)}` : ""}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{proposal.change_request}</p>
          </div>
        )}
        {proposal.personal_note && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Personal note</p>
            <p className="font-serif italic text-lg text-primary/90 whitespace-pre-wrap">{proposal.personal_note}</p>
          </div>
        )}
        {options.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Options presented</p>
            <div className="grid md:grid-cols-2 gap-4">
              {options.map((o) => (
                <div key={o.key} className={`rounded-lg border p-4 ${proposal.selected_option === o.key ? "border-gold ring-2 ring-gold/40" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="font-serif italic text-lg text-primary">{o.name}</h4>
                    {proposal.selected_option === o.key && <StatusPill status="chosen" tone="ok" />}
                  </div>
                  <p className="text-xl text-foreground font-medium mb-2">${Number(o.total).toLocaleString()}</p>
                  <ul className="space-y-1">
                    {(o.line_items ?? []).map((it, idx) => (
                      <li key={idx} className="flex justify-between gap-3 text-xs text-muted-foreground">
                        <span>{it.label}</span>
                        <span className="whitespace-nowrap">${Number(it.amount).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
        {(options.length === 0 || proposal.status === "accepted") && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
              {options.length > 0 ? "Agreed line items" : "Line items"}
            </p>
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
        )}
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
          <div className="flex items-center gap-2">
            {contract.file_url && (
              <button
                onClick={() => openSignedContractPdf(contract.file_url!)}
                className="inline-flex items-center gap-1.5 border border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10"
              >
                <Download size={12} /> Download PDF
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 border border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
        </div>

        {contract.file_url ? (
          <div className="bg-background-alt/40 rounded-md p-6 border border-border text-center">
            <FileText size={32} className="mx-auto text-gold mb-3" />
            <p className="font-serif italic text-primary text-lg">Uploaded signed contract</p>
            <p className="text-sm text-muted-foreground mt-1">{contract.content || "Signed outside the app."}</p>
            <button
              onClick={() => openSignedContractPdf(contract.file_url!)}
              className="mt-4 inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
            >
              <Download size={14} /> Open PDF
            </button>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none font-serif text-foreground">
            {contract.content ? <ReactMarkdown>{contract.content}</ReactMarkdown> : <p className="text-muted-foreground italic">No content.</p>}
          </div>
        )}


        {!contract.file_url && (
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
        )}

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

// ============= PROPOSAL EDITOR =============

type EditableOption = { key: string; name: string; description: string; line_items: Array<{ label: string; amount: number }>; discount: number };

function proposalTemplate(client: { couple_name_1: string; couple_name_2: string | null; wedding_date: string | null }): { personal_note: string; valid_until: string; options: EditableOption[] } {
  const names = client.couple_name_2 ? `${client.couple_name_1} & ${client.couple_name_2}` : client.couple_name_1;
  const dateTxt = client.wedding_date
    ? new Date(client.wedding_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "your date";
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  return {
    personal_note:
      `${names}, thank you for reaching out. ${dateTxt} is open, and it's yours if you want it.\n\n` +
      `I've shaped two versions of your day. Choose whichever feels right.\n\n` +
      `Every proposal is flexible. Packaging can always be adjusted to your preferences. If neither option is quite right, use "Request a change" below and tell me what you'd shift. Warmly, Victoria`,
    valid_until: validUntil.toISOString().slice(0, 10),
    options: [
      {
        key: "full_story",
        name: "The Full Story",
        description: "Every hour of your day, in photographs and film, from the first quiet moments of getting ready to the last song.",
        line_items: [
          { label: "Wedding day photography, 10 hours of coverage with Victoria", amount: 7500 },
          { label: "Second photographer, full coverage alongside Victoria", amount: 1000 },
          { label: "Extended-day post-production: added editing and culling", amount: 800 },
          { label: "Full-day videography with documentary edit plus highlight film", amount: 6000 },
        ],
        discount: 800,
      },
      {
        key: "focused_day",
        name: "The Focused Day",
        description: "A continuous 10 hours built around the moments that matter most, through a full hour of open dance floor.",
        line_items: [
          { label: "Wedding day photography, 10 continuous hours with Victoria", amount: 7500 },
          { label: "Second photographer, full coverage alongside Victoria", amount: 1000 },
          { label: "Documentary film, 6 hours: ceremonies, dances and speeches", amount: 4000 },
        ],
        discount: 0,
      },
    ],
  };
}

function optTotals(o: EditableOption) {
  const subtotal = o.line_items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  return { subtotal, total: subtotal - (Number(o.discount) || 0) };
}

function ProposalEditorModal({ clientId, client, proposal, onClose, onSaved }: {
  clientId: string;
  client: { couple_name_1: string; couple_name_2: string | null; wedding_date: string | null };
  proposal: Proposal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tpl = useMemo(() => proposalTemplate(client), [client]);
  const [note, setNote] = useState<string>(proposal?.personal_note ?? tpl.personal_note);
  const [validUntil, setValidUntil] = useState<string>(proposal?.valid_until ?? tpl.valid_until);
  const [opts, setOpts] = useState<EditableOption[]>(() =>
    proposal && Array.isArray(proposal.options) && proposal.options.length > 0
      ? proposal.options.map((o) => ({
          key: o.key, name: o.name, description: o.description ?? "",
          line_items: (o.line_items ?? []).map((it) => ({ label: it.label, amount: Number(it.amount) })),
          discount: Number(o.discount ?? 0),
        }))
      : tpl.options,
  );
  const [saving, setSaving] = useState(false);

  const setOpt = (i: number, patch: Partial<EditableOption>) =>
    setOpts((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const setItem = (i: number, k: number, patch: Partial<{ label: string; amount: number }>) =>
    setOpts((os) => os.map((o, j) => j === i ? { ...o, line_items: o.line_items.map((it, m) => (m === k ? { ...it, ...patch } : it)) } : o));

  const save = async (publish: boolean) => {
    for (const o of opts) {
      if (!o.name.trim()) { toast.error("Every option needs a name."); return; }
      if (o.line_items.length === 0) { toast.error(`"${o.name}" needs at least one line item.`); return; }
      if (o.line_items.some((it) => !it.label.trim())) { toast.error(`"${o.name}" has an unnamed line item.`); return; }
    }
    setSaving(true);
    const jsonOptions = opts.map((o, i) => {
      const { subtotal, total } = optTotals(o);
      return {
        key: o.key || `option_${i + 1}`,
        name: o.name.trim(),
        description: o.description.trim() || undefined,
        line_items: o.line_items.map((it) => ({ label: it.label.trim(), amount: Number(it.amount) || 0 })),
        subtotal, discount: Number(o.discount) || 0, total,
      };
    });
    const first = jsonOptions[0];
    const payload: Record<string, unknown> = {
      client_id: clientId,
      personal_note: note.trim() || null,
      valid_until: validUntil || null,
      options: jsonOptions,
      line_items: first.line_items,
      subtotal: first.subtotal,
      discount: first.discount,
      total: first.total,
    };
    if (publish) {
      payload.status = "sent";
      payload.sent_at = proposal?.sent_at ?? new Date().toISOString();
    }
    const q = proposal
      ? supabase.from("proposals").update(payload).eq("id", proposal.id)
      : supabase.from("proposals").insert({ status: "draft", ...payload });
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(publish ? "Proposal published to the portal." : "Proposal saved as draft.");
    onSaved();
  };

  const inputCls = "w-full px-3 py-2 bg-surface border border-input rounded-md text-sm";

  return (
    <ModalShell title={proposal ? "Edit proposal" : "New proposal"} onClose={onClose}>
      <div className="px-6 md:px-10 py-8 space-y-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Personal note (the couple reads this first)</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={7} className={inputCls} />
        </div>

        <div className="space-y-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Options the couple chooses from</p>
          {opts.map((o, i) => {
            const { subtotal, total } = optTotals(o);
            return (
              <div key={i} className="rounded-lg border border-border p-5 space-y-3">
                <div className="flex flex-wrap gap-3">
                  <input value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} placeholder="Option name" className={`${inputCls} md:max-w-[260px] font-serif italic text-lg`} />
                  {opts.length > 1 && (
                    <button onClick={() => setOpts((os) => os.filter((_, j) => j !== i))} className="text-xs text-muted-foreground hover:text-magenta uppercase tracking-wider ml-auto">
                      Remove option
                    </button>
                  )}
                </div>
                <input value={o.description} onChange={(e) => setOpt(i, { description: e.target.value })} placeholder="One-line description the couple sees under the name" className={inputCls} />
                <div className="space-y-2">
                  {o.line_items.map((it, k) => (
                    <div key={k} className="flex gap-2 items-center">
                      <input value={it.label} onChange={(e) => setItem(i, k, { label: e.target.value })} placeholder="Line item" className={inputCls} />
                      <input type="number" value={it.amount} onChange={(e) => setItem(i, k, { amount: Number(e.target.value) })} className={`${inputCls} w-28 text-right`} />
                      <button onClick={() => setOpt(i, { line_items: o.line_items.filter((_, m) => m !== k) })} className="text-muted-foreground hover:text-magenta" aria-label="Remove line item">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setOpt(i, { line_items: [...o.line_items, { label: "", amount: 0 }] })} className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider">
                    <Plus size={12} /> Add line item
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 border-t border-border/60">
                  <label className="text-sm text-muted-foreground inline-flex items-center gap-2">
                    Discount $
                    <input type="number" value={o.discount} onChange={(e) => setOpt(i, { discount: Number(e.target.value) })} className={`${inputCls} w-24 text-right`} />
                  </label>
                  <span className="text-sm text-muted-foreground">Subtotal ${subtotal.toLocaleString()}</span>
                  <span className="font-serif italic text-lg text-primary ml-auto">Total ${total.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
          {opts.length < 3 && (
            <button
              onClick={() => setOpts((os) => [...os, { key: `option_${os.length + 1}`, name: "", description: "", line_items: [{ label: "", amount: 0 }], discount: 0 }])}
              className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-primary uppercase tracking-wider"
            >
              <Plus size={12} /> Add another option
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="text-sm text-muted-foreground">
            Valid until
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <div className="flex gap-3">
            <button onClick={() => save(false)} disabled={saving} className="border border-gold text-gold px-5 py-2.5 rounded-md text-sm hover:bg-gold/10 disabled:opacity-50">
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button onClick={() => save(true)} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
              {saving ? "Saving…" : proposal?.status === "sent" ? "Save changes (live in portal)" : "Publish to portal"}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Drafts are invisible to the couple. Once published, they see it in their portal's Documents, choose an option, and either accept (with an optional note) or send you a change request. Publishing also moves their card to "Proposal Sent" on the pipeline.
        </p>
      </div>
    </ModalShell>
  );
}
