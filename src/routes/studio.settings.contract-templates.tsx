import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { relativeTime } from "@/lib/dates";
import { ContractTemplateEditor } from "@/components/studio/ContractTemplateEditor";
import { BlockBuilder } from "@/components/studio/BlockBuilder";
import { Plus, Search, ArrowLeft, Copy, Archive, ArchiveRestore, Pencil } from "lucide-react";

export const Route = createFileRoute("/studio/settings/contract-templates")({
  validateSearch: (search: Record<string, unknown>) => ({
    duplicate: typeof search.duplicate === "string" ? search.duplicate : undefined,
  }),
  component: ContractTemplatesSettings,
});

interface TplRow {
  id: string;
  name: string;
  content: string;
  template_type: string;
  is_archived: boolean;
  updated_at: string;
  created_by: string | null;
  signature_required_role: string;
  is_block_based: boolean;
}

const TYPE_OPTIONS = [
  { value: "contractor", label: "Contractor", color: "bg-plum/15 text-plum border-plum/30" },
  { value: "couple_booking", label: "Couple booking", color: "bg-magenta/15 text-magenta border-magenta/30" },
  { value: "couple_retainer", label: "Couple retainer", color: "bg-gold/15 text-gold border-gold/40" },
  { value: "addendum", label: "Addendum", color: "bg-sage/20 text-foreground border-sage/40" },
  { value: "other", label: "Other", color: "bg-background-alt text-muted-foreground border-border" },
];

function typePill(type: string) {
  const o = TYPE_OPTIONS.find((t) => t.value === type) ?? TYPE_OPTIONS[TYPE_OPTIONS.length - 1];
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${o.color}`}>{o.label}</span>;
}

function ContractTemplatesSettings() {
  const { user } = useAuth();
  const urlSearch = useSearch({ from: "/studio/settings/contract-templates" });
  const navigate = useNavigate({ from: "/studio/settings/contract-templates" });
  const [rows, setRows] = useState<TplRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [archivedFilter, setArchivedFilter] = useState<"active" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TplRow | "new" | null>(null);
  const [duplicateProcessed, setDuplicateProcessed] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contract_templates")
      .select("id, name, content, template_type, is_archived, updated_at, created_by, signature_required_role, is_block_based")
      .order("updated_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Handle ?duplicate=<templateId> — clone the template (and blocks) then open editor.
  useEffect(() => {
    const dupId = (urlSearch as any)?.duplicate as string | undefined;
    if (!dupId || duplicateProcessed) return;
    setDuplicateProcessed(true);
    (async () => {
      const { data: orig } = await supabase
        .from("contract_templates")
        .select("*")
        .eq("id", dupId)
        .maybeSingle();
      if (!orig) {
        toast.error("Template to duplicate not found");
        navigate({ search: {} as any, replace: true });
        return;
      }
      const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const { data: dupe, error } = await supabase
        .from("contract_templates")
        .insert({
          name: `${orig.name} — Custom for ${dateStr}`,
          content: orig.content,
          template_type: orig.template_type,
          signature_required_role: orig.signature_required_role,
          is_block_based: orig.is_block_based,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error || !dupe) {
        toast.error(error?.message ?? "Failed to duplicate");
        navigate({ search: {} as any, replace: true });
        return;
      }
      if (orig.is_block_based) {
        const { data: blocks } = await supabase
          .from("contract_template_blocks")
          .select("position, block_type, config, content")
          .eq("template_id", orig.id)
          .order("position");
        if (blocks?.length) {
          await supabase.from("contract_template_blocks").insert(
            blocks.map((b: any) => ({ ...b, template_id: dupe.id }))
          );
        }
      }
      toast.success("Custom template created");
      navigate({ search: {} as any, replace: true });
      await load();
      setEditing(dupe as any);
    })();
  }, [urlSearch, duplicateProcessed, user?.id, navigate]);


  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && (r.template_type ?? "other") !== typeFilter) return false;
      if (archivedFilter === "active" && r.is_archived) return false;
      if (archivedFilter === "archived" && !r.is_archived) return false;
      if (search.trim() && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, typeFilter, archivedFilter, search]);

  const duplicate = async (r: TplRow) => {
    const { data, error } = await supabase
      .from("contract_templates")
      .insert({
        name: `${r.name} (Copy)`,
        content: r.content,
        template_type: r.template_type,
        signature_required_role: r.signature_required_role,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();
    if (error || !data) return toast.error(error?.message ?? "Failed to duplicate");
    toast.success("Duplicated");
    await load();
    setEditing(data as any);
  };

  const archive = async (r: TplRow, restore = false) => {
    const { error } = await supabase
      .from("contract_templates")
      .update({ is_archived: !restore })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(restore ? "Restored" : "Archived");
    load();
  };

  if (editing) {
    return (
      <EditorView
        row={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Contract templates</h1>
          <p className="text-sm text-muted-foreground mt-1">Reusable templates for couple, contractor, and retainer agreements.</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
        >
          <Plus size={14} /> New template
        </button>
      </header>

      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full pl-8 pr-3 py-2 bg-surface border border-border rounded-md text-sm"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 bg-surface border border-border rounded-md text-sm">
          <option value="all">All types</option>
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={archivedFilter} onChange={(e) => setArchivedFilter(e.target.value as any)} className="px-3 py-2 bg-surface border border-border rounded-md text-sm">
          <option value="active">Active only</option>
          <option value="archived">Archived only</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-16 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No templates match.</p>
          <p className="text-sm text-muted-foreground mt-2">Adjust your filters or create a new one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-serif italic text-lg text-primary">{r.name}</h3>
                  {typePill(r.template_type ?? "other")}
                  {r.is_archived && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">archived</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Updated {relativeTime(r.updated_at)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(r)} className="text-xs px-2 py-1.5 rounded hover:bg-background-alt text-foreground inline-flex items-center gap-1" title="Edit"><Pencil size={12} /> Edit</button>
                <button onClick={() => duplicate(r)} className="text-xs px-2 py-1.5 rounded hover:bg-background-alt text-foreground inline-flex items-center gap-1" title="Duplicate"><Copy size={12} /> Duplicate</button>
                {r.is_archived ? (
                  <button onClick={() => archive(r, true)} className="text-xs px-2 py-1.5 rounded hover:bg-background-alt text-sage inline-flex items-center gap-1"><ArchiveRestore size={12} /> Restore</button>
                ) : (
                  <button onClick={() => archive(r)} className="text-xs px-2 py-1.5 rounded hover:bg-background-alt text-magenta inline-flex items-center gap-1"><Archive size={12} /> Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorView({ row, onClose, onSaved }: { row: TplRow | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const isNew = !row;
  const [name, setName] = useState(row?.name ?? "");
  const [type, setType] = useState(row?.template_type ?? "contractor");
  const [content, setContent] = useState(row?.content ?? "");
  const [isBlockBased, setIsBlockBased] = useState(row?.is_block_based ?? false);
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(row?.id ?? null);

  const isCoupleTemplate = type.startsWith("couple");

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    if (!createdId) {
      const { data, error } = await supabase.from("contract_templates").insert({
        name: name.trim(), content, template_type: type, is_block_based: isBlockBased, created_by: user?.id ?? null,
      }).select("id").single();
      setSaving(false);
      if (error || !data) return toast.error(error?.message ?? "Save failed");
      setCreatedId(data.id);
      toast.success("Saved");
      if (!isBlockBased) onSaved();
    } else {
      const { error } = await supabase.from("contract_templates").update({
        name: name.trim(), content, template_type: type, is_block_based: isBlockBased,
      }).eq("id", createdId);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Saved");
      onSaved();
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Back to templates
      </button>
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">
            {isNew && !createdId ? "New contract template" : "Edit template"}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Template name <span className="text-magenta">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Wedding photography agreement" className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Template type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm">
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {isCoupleTemplate && (
        <label className="flex items-center gap-2 text-sm text-foreground bg-background-alt border border-border rounded-md px-3 py-2">
          <input type="checkbox" checked={isBlockBased} onChange={(e) => setIsBlockBased(e.target.checked)} />
          <span>Use block builder (interactive blocks, multi-signer)</span>
        </label>
      )}

      {isBlockBased && isCoupleTemplate ? (
        createdId ? (
          <BlockBuilder templateId={createdId} />
        ) : (
          <div className="bg-gold/10 border border-gold/40 rounded-md p-4 text-sm text-foreground">
            Save the template once to start adding blocks.
          </div>
        )
      ) : (
        <ContractTemplateEditor initialContent={content} templateType={type} onChange={setContent} />
      )}
    </div>
  );
}
