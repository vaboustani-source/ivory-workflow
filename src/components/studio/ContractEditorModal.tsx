import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X } from "lucide-react";
import { ContractMarkdownEditor } from "./ContractMarkdownEditor";
import { buildClientPlaceholderContext, resolvePlaceholders } from "@/lib/placeholders";

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
  is_block_based?: boolean;
}

interface Props {
  client: ClientLite;
  /** When provided, modal opens in edit mode for this contract. */
  existingContractId?: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create-or-edit contract modal. Two-column markdown editor + live preview
 * with the actual client's data substituted.
 */
export function ContractEditorModal({ client, existingContractId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("blank");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [signatureRole, setSignatureRole] = useState<"partner_1" | "both_partners">("partner_1");
  const [contractStatus, setContractStatus] = useState<string>("draft");
  const [showSentWarning, setShowSentWarning] = useState(false);
  const [studioRow, setStudioRow] = useState<any>(null);
  const isEdit = !!existingContractId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tplPromise = supabase
        .from("contract_templates")
        .select("id, name, content, signature_required_role, template_type")
        .eq("is_archived", false)
        .order("name");
      const contractPromise = existingContractId
        ? supabase.from("contracts").select("*").eq("id", existingContractId).maybeSingle()
        : Promise.resolve({ data: null });
      const studioPromise = supabase.from("studio_settings").select("photographer_name, photographer_company, studio_email, studio_phone, studio_address, studio_mailing_address, ein, instagram, website, overage_hourly_rate, video_cancellation_fee, album_credit_expiry_months, rescheduling_fee_pct").eq("is_active", true).maybeSingle();
      const [{ data: tpls }, { data: contract }, { data: studio }] = await Promise.all([tplPromise, contractPromise as any, studioPromise]);
      if (cancelled) return;
      const filtered = ((tpls ?? []) as any[]).filter((t) => !t.template_type || t.template_type === "couple_booking" || t.template_type === "couple_retainer" || t.template_type === "couple" || t.template_type === "addendum");
      setTemplates(filtered as any);
      setStudioRow(studio as any);
      if (contract) {
        setTitle(contract.title ?? "");
        setContent(contract.content ?? "");
        setSignatureRole((contract.signature_required_role as any) ?? "partner_1");
        setContractStatus(contract.status ?? "draft");
        setSelectedTemplateId(contract.template_id ?? "blank");
        if (contract.status === "sent") setShowSentWarning(true);
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

  const ctx = useMemo(() => buildClientPlaceholderContext(client, {
    photographerName: studioRow?.photographer_name,
    photographerCompany: studioRow?.photographer_company,
    studioEmail: studioRow?.studio_email,
    studioPhone: studioRow?.studio_phone,
  }), [client, studioRow]);

  const applyTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    if (tplId === "blank") return;
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    if (!title.trim()) setTitle(tpl.name);
    setContent(tpl.content);
    setSignatureRole((tpl.signature_required_role as any) ?? "partner_1");
  };

  const validate = (): string | null => {
    if (!title.trim()) return "Title is required";
    if (!content.trim()) return "Contract body is required";
    return null;
  };

  const saveDraft = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    const payload = {
      client_id: client.id,
      title: title.trim(),
      content,
      signature_required_role: signatureRole,
      template_id: selectedTemplateId === "blank" ? null : selectedTemplateId,
    };
    if (isEdit) {
      const { error } = await supabase.from("contracts").update(payload).eq("id", existingContractId!);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Draft saved");
      onSaved(); onClose();
    } else {
      const { error } = await supabase.from("contracts").insert({ ...payload, status: "draft" });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Draft saved");
      onSaved(); onClose();
    }
  };

  const sendToCouple = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    const resolvedContent = resolvePlaceholders(content, ctx);
    const payload = {
      client_id: client.id,
      title: title.trim(),
      content: resolvedContent,
      signature_required_role: signatureRole,
      template_id: selectedTemplateId === "blank" ? null : selectedTemplateId,
      status: "sent" as const,
      sent_at: new Date().toISOString(),
    };
    let contractId = existingContractId;
    if (isEdit) {
      const { error } = await supabase.from("contracts").update(payload).eq("id", existingContractId!);
      if (error) { setSaving(false); toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("contracts").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); toast.error(error?.message ?? "Failed to create"); return; }
      contractId = data.id;
    }

    // Fire email — failures don't roll back the contract.
    try {
      const { error: fnErr } = await supabase.functions.invoke("send-document-to-client", {
        body: { type: "contract", document_id: contractId, client_id: client.id },
      });
      if (fnErr) console.error("send-document-to-client error:", fnErr);
    } catch (e) {
      console.error("send-document-to-client invoke failed:", e);
    }

    setSaving(false);
    const coupleName = client.couple_name_1 + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");

    try {
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        client_id: client.id,
        action_type: "contract.sent",
        target_type: "contract",
        target_id: contractId ?? undefined,
        description: `Contract sent to ${coupleName}`,
        client_facing_text: "Your contract is ready to review",
        is_client_visible: true,
      });
    } catch { /* noop */ }

    toast.success(`Contract sent to ${coupleName}`);
    onSaved(); onClose();
  };

  const recall = async () => {
    if (!isEdit) return;
    if (!confirm("Recall this contract? It will move back to draft and the couple will no longer see it.")) return;
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
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[1200px] max-h-screen md:max-h-[95vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
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
              {showSentWarning && (
                <div className="bg-gold/10 border border-gold/40 rounded-md p-4 text-sm text-foreground">
                  This contract has already been sent. Editing will update what the couple sees in their portal — their existing link still works.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {!isEdit && (
                  <div>
                    <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
                      Start from template
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="blank">Blank</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={isEdit ? "md:col-span-2" : ""}>
                  <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
                    Contract title <span className="text-magenta">*</span>
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Wedding photography agreement"
                    className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <ContractMarkdownEditor
                content={content}
                onContentChange={setContent}
                signatureRequiredRole={signatureRole}
                onSignatureRoleChange={setSignatureRole}
                previewContext={ctx}
              />
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
              onClick={saveDraft}
              disabled={saving || loading}
              className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 disabled:opacity-50"
            >
              {isEdit && contractStatus === "sent" ? "Save changes" : "Save draft"}
            </button>
            {(!isEdit || contractStatus === "draft") && (
              <button
                onClick={sendToCouple}
                disabled={saving || loading}
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
