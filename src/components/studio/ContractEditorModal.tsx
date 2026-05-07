import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, ExternalLink } from "lucide-react";
import { buildClientPlaceholderContext, resolvePlaceholders } from "@/lib/placeholders";
import { BlockBasedContractPreview } from "./BlockBasedContractPreview";
import { SIGNER_ROLE_LABELS, type SignerRole } from "@/lib/contractBlocks";

interface ClientLite {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  venue_name: string | null;
  primary_email: string | null;
  primary_client_last_name?: string | null;
  alternate_client_last_name?: string | null;
  primary_client_phone?: string | null;
  alternate_client_phone?: string | null;
  shared_street_address?: string | null;
  shared_city?: string | null;
  shared_state?: string | null;
  shared_zipcode?: string | null;
}

interface Template {
  id: string;
  name: string;
  content: string;
  signature_required_role: string;
  template_type: string;
  is_block_based: boolean;
}

interface Props {
  client: ClientLite;
  existingContractId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_PILL: Record<string, { label: string; cls: string }> = {
  couple_booking: { label: "Couple booking", cls: "bg-magenta/15 text-magenta border-magenta/30" },
  couple_retainer: { label: "Couple retainer", cls: "bg-gold/15 text-gold border-gold/40" },
  couple: { label: "Couple", cls: "bg-magenta/15 text-magenta border-magenta/30" },
  addendum: { label: "Addendum", cls: "bg-sage/20 text-foreground border-sage/40" },
};

export function ContractEditorModal({ client, existingContractId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [contractStatus, setContractStatus] = useState<string>("draft");
  const [studioRow, setStudioRow] = useState<any>(null);
  const [templateSigners, setTemplateSigners] = useState<SignerRole[]>([]);
  const isEdit = !!existingContractId;

  const coupleNames = client.couple_name_1 + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tplPromise = supabase
        .from("contract_templates")
        .select("id, name, content, signature_required_role, template_type, is_block_based")
        .eq("is_archived", false)
        .in("template_type", ["couple_booking", "couple_retainer", "couple", "addendum"])
        .order("name");
      const contractPromise = existingContractId
        ? supabase.from("contracts").select("*").eq("id", existingContractId).maybeSingle()
        : Promise.resolve({ data: null });
      const studioPromise = supabase.from("studio_settings").select("photographer_name, photographer_company, studio_email, studio_phone").eq("is_active", true).maybeSingle();
      const [{ data: tpls }, { data: contract }, { data: studio }] = await Promise.all([tplPromise, contractPromise as any, studioPromise]);
      if (cancelled) return;
      setTemplates((tpls ?? []) as any);
      setStudioRow(studio as any);
      if (contract) {
        setTitle(contract.title ?? "");
        setContractStatus(contract.status ?? "draft");
        if (contract.template_id) setSelectedTemplateId(contract.template_id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [existingContractId]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId), [templates, selectedTemplateId]);

  // When template selected, derive title and signers
  useEffect(() => {
    if (!selectedTemplate) { setTemplateSigners([]); return; }
    if (!isEdit) {
      setTitle(`${selectedTemplate.name} — ${coupleNames}`);
    }
    (async () => {
      if (selectedTemplate.is_block_based) {
        const { data } = await supabase
          .from("contract_template_blocks")
          .select("block_type, config")
          .eq("template_id", selectedTemplate.id)
          .in("block_type", ["initials", "signature"]);
        const roles = new Set<SignerRole>();
        (data ?? []).forEach((b: any) => {
          const r = b.config?.signer_role as SignerRole | undefined;
          if (r) roles.add(r);
        });
        if (!roles.size) roles.add("partner_1");
        setTemplateSigners(Array.from(roles));
      } else {
        // HTML templates: default
        if (selectedTemplate.template_type === "couple_booking") {
          setTemplateSigners(["partner_1", "partner_2"]);
        } else {
          setTemplateSigners(["partner_1"]);
        }
      }
    })();
  }, [selectedTemplate, coupleNames, isEdit]);

  const ctx = useMemo(() => buildClientPlaceholderContext(client, {
    photographerName: studioRow?.photographer_name,
    photographerCompany: studioRow?.photographer_company,
    studioEmail: studioRow?.studio_email,
    studioPhone: studioRow?.studio_phone,
  }), [client, studioRow]);

  const validate = (): string | null => {
    if (!selectedTemplate) return "Pick a template";
    if (!title.trim()) return "Title is required";
    return null;
  };

  const computeSignatureRole = (): "partner_1" | "both_partners" => {
    return templateSigners.includes("partner_2") ? "both_partners" : "partner_1";
  };

  const persistContract = async (status: "draft" | "sent") => {
    const err = validate();
    if (err) { toast.error(err); return null; }
    setSaving(true);
    const tpl = selectedTemplate!;
    const isBlockBased = tpl.is_block_based;
    const resolvedContent = isBlockBased ? "" : resolvePlaceholders(tpl.content || "", ctx);
    const payload: any = {
      client_id: client.id,
      title: title.trim(),
      content: resolvedContent,
      signature_required_role: computeSignatureRole(),
      template_id: tpl.id,
      is_block_based: isBlockBased,
      status,
    };
    if (status === "sent") payload.sent_at = new Date().toISOString();

    let contractId = existingContractId;
    if (isEdit) {
      const { error } = await supabase.from("contracts").update(payload).eq("id", existingContractId!);
      if (error) { setSaving(false); toast.error(error.message); return null; }
    } else {
      const { data, error } = await supabase.from("contracts").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); toast.error(error?.message ?? "Failed to create"); return null; }
      contractId = data.id;
    }

    if (isBlockBased && contractId) {
      try {
        const { data: tplBlocks } = await supabase
          .from("contract_template_blocks")
          .select("*")
          .eq("template_id", tpl.id)
          .order("position");
        await supabase.from("contract_blocks").delete().eq("contract_id", contractId);
        const cloned = (tplBlocks ?? []).map((b: any) => {
          const isText = b.block_type === "text_box";
          const resolvedText = isText ? resolvePlaceholders(b.content || b.config?.content || "", ctx) : null;
          const config = isText ? { ...(b.config ?? {}), content: resolvedText } : b.config;
          return {
            contract_id: contractId,
            position: b.position,
            block_type: b.block_type,
            config,
            content: isText ? resolvedText : b.content,
            signer_role: (b.config?.signer_role as string | undefined) ?? null,
          };
        });
        if (cloned.length) await supabase.from("contract_blocks").insert(cloned);
      } catch (e) {
        console.error("Block clone failed:", e);
      }
    }

    if (status === "sent" && contractId) {
      // Create signers
      const tokenFor = () => crypto.randomUUID().replace(/-/g, "");
      const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const signerRows: any[] = [];
      for (const role of templateSigners) {
        let name: string | null = null;
        let email: string | null = null;
        if (role === "partner_1") {
          name = [client.couple_name_1, client.primary_client_last_name].filter(Boolean).join(" ") || null;
          email = client.primary_email;
        } else if (role === "partner_2") {
          name = [client.couple_name_2, client.alternate_client_last_name].filter(Boolean).join(" ") || null;
          email = (client as any).secondary_email ?? null;
        } else if (role === "photographer") {
          name = studioRow?.photographer_name ?? "Photographer";
          email = studioRow?.studio_email ?? null;
        }
        signerRows.push({ contract_id: contractId, signer_role: role, name, email, public_token: tokenFor(), public_token_expires_at: expires });
      }
      await supabase.from("contract_signers").delete().eq("contract_id", contractId);
      if (signerRows.length) await supabase.from("contract_signers").insert(signerRows);

      try {
        const { error: fnErr } = await supabase.functions.invoke("send-document-to-client", {
          body: { type: "contract", document_id: contractId, client_id: client.id },
        });
        if (fnErr) console.error("send-document-to-client error:", fnErr);
      } catch (e) {
        console.error("send-document-to-client invoke failed:", e);
      }

      try {
        const { logActivity } = await import("@/lib/activityLog");
        await logActivity({
          client_id: client.id,
          action_type: "contract.sent",
          target_type: "contract",
          target_id: contractId ?? undefined,
          description: `Contract sent to ${coupleNames}`,
          client_facing_text: "Your contract is ready to review",
          is_client_visible: true,
        });
      } catch { /* noop */ }
    }

    setSaving(false);
    toast.success(status === "sent" ? `Contract sent to ${coupleNames}` : "Draft saved");
    onSaved();
    onClose();
    return contractId;
  };

  const recall = async () => {
    if (!isEdit) return;
    if (!confirm("Recall this contract? It will move back to draft.")) return;
    const { error } = await supabase
      .from("contracts")
      .update({ status: "draft", sent_at: null })
      .eq("id", existingContractId!);
    if (error) { toast.error(error.message); return; }
    toast.success("Contract recalled to draft");
    onSaved(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[760px] max-h-screen md:max-h-[95vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary truncate pr-4">
            {isEdit ? "Edit contract" : "Create contract"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6">
          {loading ? (
            <p className="font-serif italic text-primary">Loading…</p>
          ) : (
            <div className="space-y-6">
              {/* Section 1: Template */}
              <div>
                <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
                  Template <span className="text-magenta">*</span>
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={isEdit && contractStatus === "sent"}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="" disabled>Choose a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTemplate && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span>Selected: {selectedTemplate.name}</span>
                    {TYPE_PILL[selectedTemplate.template_type] && (
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${TYPE_PILL[selectedTemplate.template_type].cls}`}>
                        {TYPE_PILL[selectedTemplate.template_type].label}
                      </span>
                    )}
                    <a
                      href={`/studio/settings/contract-templates?duplicate=${selectedTemplate.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-magenta hover:underline"
                    >
                      Duplicate to a custom template <ExternalLink size={11} />
                    </a>
                  </div>
                )}
              </div>

              {/* Section 2: Signers */}
              {selectedTemplate && (
                <div>
                  <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Signers</label>
                  <div className="px-3 py-2 bg-background-alt border border-border rounded-md text-sm text-foreground">
                    {templateSigners.length
                      ? templateSigners.map((r) => SIGNER_ROLE_LABELS[r]).join(", ")
                      : "Primary client"}
                  </div>
                </div>
              )}

              {/* Section 3: Title */}
              {selectedTemplate && (
                <div>
                  <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
                    Contract title <span className="text-magenta">*</span>
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              )}

              {/* Section 4: Preview */}
              {selectedTemplate && (
                <div>
                  <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Preview</label>
                  <p className="text-xs text-muted-foreground italic mb-2">
                    This is what {coupleNames} will see when they open the contract.
                  </p>
                  <div className="border border-border rounded-md bg-background-alt/40 p-5 max-h-[50vh] overflow-y-auto">
                    {selectedTemplate.is_block_based ? (
                      <BlockBasedContractPreview templateId={selectedTemplate.id} clientId={client.id} />
                    ) : (
                      <div
                        className="prose prose-sm max-w-none text-foreground"
                        dangerouslySetInnerHTML={{ __html: resolvePlaceholders(selectedTemplate.content || "", ctx) }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-gold/30 px-6 py-4 flex items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-sm text-muted-foreground hover:text-magenta">Cancel</button>
            {isEdit && contractStatus === "sent" && (
              <button onClick={recall} className="text-xs text-magenta hover:underline">Recall to draft</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => persistContract("draft")}
              disabled={saving || loading || !selectedTemplate}
              className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 disabled:opacity-50"
            >
              Save draft
            </button>
            {(!isEdit || contractStatus === "draft") && (
              <button
                onClick={() => persistContract("sent")}
                disabled={saving || loading || !selectedTemplate}
                className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Sending…" : "Send to couple"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
