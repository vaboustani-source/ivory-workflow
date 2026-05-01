import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { ContractMarkdownEditor } from "@/components/studio/ContractMarkdownEditor";

export const Route = createFileRoute("/studio/contracts/templates/$id")({
  component: ContractTemplateEditor,
});

function ContractTemplateEditor() {
  const { id } = useParams({ from: "/studio/contracts/templates/$id" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [signatureRole, setSignatureRole] = useState<"partner_1" | "both_partners">("partner_1");
  const [isArchived, setIsArchived] = useState(false);
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("contract_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Template not found");
        navigate({ to: "/studio/contracts/templates" });
        return;
      }
      setName(data.name ?? "");
      setDescription(data.description ?? "");
      setContent(data.content ?? "");
      setSignatureRole((data.signature_required_role as any) ?? "partner_1");
      setIsArchived(!!data.is_archived);
      setCreatedBy(data.created_by ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew, navigate]);

  const canEdit = isNew || !createdBy || createdBy === user?.id;

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    if (isNew) {
      const { data, error } = await supabase
        .from("contract_templates")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          content,
          signature_required_role: signatureRole,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Template saved");
      navigate({ to: "/studio/contracts/templates/$id", params: { id: data.id } });
    } else {
      const { error } = await supabase
        .from("contract_templates")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          content,
          signature_required_role: signatureRole,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Template saved");
    }
  };

  const archive = async () => {
    if (isNew) return;
    if (!confirm("Archive this template? It will be hidden from new contract dropdowns.")) return;
    const { error } = await supabase
      .from("contract_templates")
      .update({ is_archived: !isArchived })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    setIsArchived((v) => !v);
    toast.success(isArchived ? "Template restored" : "Template archived");
  };

  if (loading) return <p className="font-serif italic text-primary p-8">Loading…</p>;

  return (
    <div className="space-y-6 pb-24">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link to="/studio/contracts" className="hover:text-primary">Contracts</Link>
          <span className="mx-2">/</span>
          <Link to="/studio/contracts/templates" className="hover:text-primary">Templates</Link>
          <span className="mx-2">/</span>
          <span>{isNew ? "New" : "Edit"}</span>
        </p>
        <h1 className="font-serif italic text-[28px] text-primary leading-tight mt-1">
          {isNew ? "New contract template" : name || "Untitled template"}
          {isArchived && <span className="ml-3 text-xs uppercase tracking-wider text-muted-foreground">archived</span>}
        </h1>
      </header>

      {!canEdit && (
        <div className="bg-gold/10 border border-gold/40 rounded-md p-4 text-sm text-foreground">
          This template was created by someone else. You can view it but not edit.
        </div>
      )}

      <fieldset disabled={!canEdit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
              Template name <span className="text-magenta">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard wedding contract"
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this contract for?"
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <ContractMarkdownEditor
          content={content}
          onContentChange={setContent}
          signatureRequiredRole={signatureRole}
          onSignatureRoleChange={setSignatureRole}
        />
      </fieldset>

      <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-gold/30 px-6 py-4 flex items-center justify-between gap-3 z-40 lg:left-[220px]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/studio/contracts/templates" })}
            className="text-sm text-muted-foreground hover:text-magenta"
          >
            Cancel
          </button>
          {!isNew && canEdit && (
            <button onClick={archive} className="text-xs text-magenta hover:underline">
              {isArchived ? "Restore" : "Archive"}
            </button>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving || !canEdit}
          className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save template"}
        </button>
      </div>
    </div>
  );
}
