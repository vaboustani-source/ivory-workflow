import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { relativeTime } from "@/lib/dates";
import { ContractTemplateEditor } from "@/components/studio/ContractTemplateEditor";
import { Plus, Search, ArrowLeft, Copy, Archive, ArchiveRestore, Pencil } from "lucide-react";

export const Route = createFileRoute("/studio/settings/contract-templates")({
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
  const [rows, setRows] = useState<TplRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [archivedFilter, setArchivedFilter] = useState<"active" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TplRow | "new" | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contract_templates")
      .select("id, name, content, template_type, is_archived, updated_at, created_by, signature_required_role")
      .order("updated_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

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
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    if (isNew) {
      const { error } = await supabase.from("contract_templates").insert({
        name: name.trim(), content, template_type: type, created_by: user?.id ?? null,
      });
      setSaving(false);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("contract_templates").update({
        name: name.trim(), content, template_type: type,
      }).eq("id", row!.id);
      setSaving(false);
      if (error) return toast.error(error.message);
    }
    toast.success("Saved");
    onSaved();
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Back to templates
      </button>
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">
            {isNew ? "New contract template" : "Edit template"}
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Second Shooter Standard Agreement" className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Template type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm">
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <ContractTemplateEditor initialContent={content} templateType={type} onChange={setContent} />
    </div>
  );
}
