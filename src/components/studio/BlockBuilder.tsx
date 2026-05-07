import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus, Pencil } from "lucide-react";
import {
  BLOCK_LIBRARY,
  defaultConfig,
  defaultContent,
  SIGNER_ROLE_LABELS,
  type BlockType,
  type ContractBlock,
  type SignerRole,
} from "@/lib/contractBlocks";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

interface Props {
  templateId: string;
}

export function BlockBuilder({ templateId }: Props) {
  const [blocks, setBlocks] = useState<ContractBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contract_template_blocks")
      .select("*")
      .eq("template_id", templateId)
      .order("position");
    setBlocks((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [templateId]);

  const addBlock = async (type: BlockType) => {
    const config = defaultConfig(type);
    const content = defaultContent(type, config);
    const position = blocks.length;
    const { data, error } = await supabase
      .from("contract_template_blocks")
      .insert({ template_id: templateId, position, block_type: type, config, content })
      .select("*")
      .single();
    if (error || !data) return toast.error(error?.message ?? "Failed to add block");
    setBlocks((b) => [...b, data as any]);
    setEditingId((data as any).id);
  };

  const updateBlock = async (id: string, patch: Partial<ContractBlock>) => {
    const { error } = await supabase
      .from("contract_template_blocks")
      .update({ config: patch.config, content: patch.content })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setBlocks((bs) => bs.map((b) => b.id === id ? { ...b, ...patch } : b));
  };

  const deleteBlock = async (id: string) => {
    if (!confirm("Delete this block?")) return;
    const { error } = await supabase.from("contract_template_blocks").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const reorder = async (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= blocks.length) return;
    const a = blocks[idx], b = blocks[swap];
    // Swap positions; use a temp negative to avoid unique conflict.
    await supabase.from("contract_template_blocks").update({ position: -1 }).eq("id", a.id);
    await supabase.from("contract_template_blocks").update({ position: a.position }).eq("id", b.id);
    await supabase.from("contract_template_blocks").update({ position: swap }).eq("id", a.id);
    const next = [...blocks];
    next[idx] = { ...b, position: a.position };
    next[swap] = { ...a, position: swap };
    setBlocks(next);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-3 space-y-3">
        {loading ? (
          <p className="font-serif italic text-primary p-8">Loading…</p>
        ) : blocks.length === 0 ? (
          <div className="bg-background-alt border border-dashed border-border rounded-md p-10 text-center">
            <p className="font-serif italic text-primary">No blocks yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Add your first block from the panel on the right.</p>
          </div>
        ) : blocks.map((b, i) => (
          <BlockCard
            key={b.id}
            block={b}
            isFirst={i === 0}
            isLast={i === blocks.length - 1}
            isEditing={editingId === b.id}
            onEdit={() => setEditingId(editingId === b.id ? null : b.id)}
            onDelete={() => deleteBlock(b.id)}
            onMoveUp={() => reorder(b.id, -1)}
            onMoveDown={() => reorder(b.id, 1)}
            onChange={(patch) => updateBlock(b.id, patch)}
          />
        ))}
      </div>
      <aside className="lg:col-span-1">
        <div className="bg-background-alt border border-border rounded-md p-4 sticky top-4 space-y-4">
          <h3 className="font-serif italic text-lg text-primary">Add a block</h3>
          {(["Display", "Form", "Signing"] as const).map((group) => (
            <div key={group}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{group}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BLOCK_LIBRARY.filter((b) => b.group === group).map((b) => (
                  <button
                    key={b.type}
                    type="button"
                    onClick={() => addBlock(b.type)}
                    className="text-xs px-2 py-2 rounded border border-border bg-surface hover:border-primary text-foreground inline-flex items-center justify-center gap-1"
                  >
                    <Plus size={10} /> {b.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function BlockCard({
  block, isFirst, isLast, isEditing, onEdit, onDelete, onMoveUp, onMoveDown, onChange,
}: {
  block: ContractBlock;
  isFirst: boolean; isLast: boolean; isEditing: boolean;
  onEdit: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  onChange: (patch: Partial<ContractBlock>) => void;
}) {
  const meta = BLOCK_LIBRARY.find((b) => b.type === block.block_type);
  return (
    <div className="bg-surface border border-border rounded-md">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background-alt/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{meta?.group}</span>
          <span className="font-serif italic text-sm text-primary">{meta?.label}</span>
          <BlockSummary block={block} />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst} className="p-1 text-muted-foreground hover:text-primary disabled:opacity-30"><ArrowUp size={14} /></button>
          <button onClick={onMoveDown} disabled={isLast} className="p-1 text-muted-foreground hover:text-primary disabled:opacity-30"><ArrowDown size={14} /></button>
          <button onClick={onEdit} className="p-1 text-muted-foreground hover:text-primary"><Pencil size={14} /></button>
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-magenta"><Trash2 size={14} /></button>
        </div>
      </div>
      {isEditing && (
        <div className="p-4">
          <BlockEditor block={block} onChange={onChange} />
        </div>
      )}
      {!isEditing && (
        <div className="px-3 py-2">
          <BlockPreview block={block} />
        </div>
      )}
    </div>
  );
}

function BlockSummary({ block }: { block: ContractBlock }) {
  const c = block.config ?? {};
  if (block.block_type === "initials" || block.block_type === "signature") {
    const role = c.signer_role as SignerRole | undefined;
    return <span className="text-[10px] uppercase tracking-wider text-gold">{role ? SIGNER_ROLE_LABELS[role] : ""}</span>;
  }
  if ("label" in c && c.label) return <span className="text-xs text-muted-foreground truncate max-w-[20rem]">— {c.label}</span>;
  return null;
}

function BlockPreview({ block }: { block: ContractBlock }) {
  const c = block.config ?? {};
  switch (block.block_type) {
    case "text_box":
      return <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: block.content || c.content || "<em>(empty)</em>" }} />;
    case "image":
      return c.url ? <img src={c.url} alt={c.alt || ""} className="max-h-40" /> : <p className="text-xs text-muted-foreground italic">No image URL</p>;
    case "divider": return <hr className={c.style === "dashed" ? "border-dashed" : c.style === "gold" ? "border-gold" : ""} />;
    case "spacer": return <div className="text-xs text-muted-foreground italic">Spacer ({c.size})</div>;
    default:
      return <p className="text-xs text-muted-foreground">{c.label || "(no label)"}{c.required ? " *" : ""}</p>;
  }
}

function BlockEditor({ block, onChange }: { block: ContractBlock; onChange: (patch: Partial<ContractBlock>) => void }) {
  const c = block.config ?? {};
  const setConfig = (patch: any, contentPatch?: string) => {
    const config = { ...c, ...patch };
    onChange({ config, content: contentPatch !== undefined ? contentPatch : (block.block_type === "text_box" ? config.content : block.content) });
  };

  switch (block.block_type) {
    case "text_box":
      return <TextBoxEditor html={block.content || c.content || ""} onChange={(html) => setConfig({ content: html }, html)} />;
    case "image":
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Image URL" full><input value={c.url || ""} onChange={(e) => setConfig({ url: e.target.value })} className="input" /></Field>
          <Field label="Alt text"><input value={c.alt || ""} onChange={(e) => setConfig({ alt: e.target.value })} className="input" /></Field>
          <Field label="Width (px)"><input type="number" value={c.width || ""} onChange={(e) => setConfig({ width: e.target.value ? Number(e.target.value) : undefined })} className="input" /></Field>
        </div>
      );
    case "divider":
      return (
        <Field label="Style">
          <select value={c.style || "solid"} onChange={(e) => setConfig({ style: e.target.value })} className="input">
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="gold">Gold</option>
          </select>
        </Field>
      );
    case "spacer":
      return (
        <Field label="Size">
          <select value={c.size || "medium"} onChange={(e) => setConfig({ size: e.target.value })} className="input">
            <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </Field>
      );
    case "initials":
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Label" full><input value={c.label || ""} onChange={(e) => setConfig({ label: e.target.value })} className="input" /></Field>
          <Field label="Signer">
            <select value={c.signer_role || "partner_1"} onChange={(e) => setConfig({ signer_role: e.target.value })} className="input">
              {(Object.keys(SIGNER_ROLE_LABELS) as SignerRole[]).map((r) => <option key={r} value={r}>{SIGNER_ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <RequiredToggle value={!!c.required} onChange={(v) => setConfig({ required: v })} />
        </div>
      );
    case "signature":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Signer">
            <select value={c.signer_role || "partner_1"} onChange={(e) => setConfig({ signer_role: e.target.value })} className="input">
              {(Object.keys(SIGNER_ROLE_LABELS) as SignerRole[]).map((r) => <option key={r} value={r}>{SIGNER_ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <RequiredToggle value={!!c.required} onChange={(v) => setConfig({ required: v })} />
          <CheckboxRow label="Collect typed name" value={!!c.show_typed_name} onChange={(v) => setConfig({ show_typed_name: v })} />
          <CheckboxRow label="Auto-stamp date" value={!!c.show_date} onChange={(v) => setConfig({ show_date: v })} />
        </div>
      );
    case "short_answer":
    case "free_response":
    case "date_select":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Label" full><input value={c.label || ""} onChange={(e) => setConfig({ label: e.target.value })} className="input" /></Field>
          <Field label="Helper text" full><input value={c.helper || ""} onChange={(e) => setConfig({ helper: e.target.value })} className="input" /></Field>
          {block.block_type !== "date_select" && (
            <Field label="Placeholder"><input value={c.placeholder || ""} onChange={(e) => setConfig({ placeholder: e.target.value })} className="input" /></Field>
          )}
          {block.block_type === "short_answer" && (
            <Field label="Auto-fill placeholder key (optional)"><input value={c.placeholder_key || ""} onChange={(e) => setConfig({ placeholder_key: e.target.value })} placeholder="e.g., primary_client_full_name" className="input" /></Field>
          )}
          <RequiredToggle value={!!c.required} onChange={(v) => setConfig({ required: v })} />
        </div>
      );
    case "dropdown":
    case "multiple_choice":
    case "checkboxes":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Label" full><input value={c.label || ""} onChange={(e) => setConfig({ label: e.target.value })} className="input" /></Field>
            <Field label="Helper text" full><input value={c.helper || ""} onChange={(e) => setConfig({ helper: e.target.value })} className="input" /></Field>
            <RequiredToggle value={!!c.required} onChange={(v) => setConfig({ required: v })} />
          </div>
          <OptionsEditor value={c.options || []} onChange={(opts) => setConfig({ options: opts })} />
        </div>
      );
  }
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-full" : ""}>
      <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function RequiredToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <CheckboxRow label="Required" value={value} onChange={onChange} />;
}

function CheckboxRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground self-end">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function OptionsEditor({ value, onChange }: { value: { value: string; label: string }[]; onChange: (v: { value: string; label: string }[]) => void }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">Options</p>
      <div className="space-y-1.5">
        {value.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input value={o.label} onChange={(e) => { const n = [...value]; n[i] = { ...o, label: e.target.value, value: o.value || e.target.value.toLowerCase().replace(/\s+/g, "_") }; onChange(n); }} placeholder="Label" className="input flex-1" />
            <input value={o.value} onChange={(e) => { const n = [...value]; n[i] = { ...o, value: e.target.value }; onChange(n); }} placeholder="value" className="input w-32" />
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-magenta hover:underline text-xs">Remove</button>
          </div>
        ))}
        <button onClick={() => onChange([...value, { value: "", label: "" }])} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add option</button>
      </div>
    </div>
  );
}

function TextBoxEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-magenta underline" } })],
    content: html,
    editorProps: { attributes: { class: "prose prose-sm max-w-none min-h-[120px] p-3 focus:outline-none" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;
  return (
    <div className="border border-border rounded-md bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "font-bold text-primary" : ""}>B</button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={`italic ${editor.isActive("italic") ? "text-primary" : ""}`}>I</button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <span className="text-muted-foreground ml-2">Use {"{placeholder_name}"} tokens — they resolve at send time.</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
