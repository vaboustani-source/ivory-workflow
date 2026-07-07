import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Plus, ArrowUp, ArrowDown, Trash2, Eye, Copy, Archive, ArchiveRestore, Pencil } from "lucide-react";
import { FieldRow, FieldErrorBoundary, type QuestionDef } from "@/routes/portal.questionnaires";
import { useAuth } from "@/lib/auth";

// Types the couple-facing renderer supports. Composite widgets have no sub-options in the editor.
const QUESTION_TYPES: { value: QuestionDef["type"]; label: string; hasOptions?: boolean; composite?: boolean; noRequired?: boolean }[] = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "single_select", label: "Single select", hasOptions: true },
  { value: "multi_select", label: "Multi select", hasOptions: true },
  { value: "file_upload", label: "File upload" },
  { value: "section_header", label: "Section header", noRequired: true },
  { value: "vendor_entry", label: "Vendor entry (composite)", composite: true },
  { value: "timeline_events", label: "Timeline events (composite)", composite: true },
  { value: "family_portrait_sequence", label: "Family portrait sequence (composite)", composite: true },
  { value: "wedding_party_shots", label: "Wedding party shots (composite)", composite: true },
  { value: "extended_portrait_shots", label: "Extended portrait shots (composite)", composite: true },
];

const STAGES = ["inquiry", "engagement", "welcome", "booking", "planning", "pre_wedding", "post_wedding"];

interface Template {
  id: string;
  name: string | null;
  stage: string | null;
  description: string | null;
  schema: any;
  is_active: boolean | null;
  is_archived: boolean;
  created_by: string | null;
  updated_at: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "question";
}

function ensureIds(schema: QuestionDef[]): QuestionDef[] {
  const seen = new Set<string>();
  return schema.map((q, i) => {
    let id = q.id?.trim() || `${slugify(q.label || q.type)}_${i}`;
    let n = 1;
    const base = id;
    while (seen.has(id)) { id = `${base}_${n++}`; }
    seen.add(id);
    return { ...q, id };
  });
}

export function FormTemplatesTab() {
  const { profile, roles } = useAuth();
  const canEdit = profile?.role === "owner" || roles.includes("studio_manager") || roles.includes("owner");

  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [previewing, setPreviewing] = useState<Template | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("questionnaire_templates")
      .select("id, name, stage, description, schema, is_active, is_archived, created_by, updated_at")
      .order("updated_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(
    () => rows.filter((r) => showArchived || !r.is_archived),
    [rows, showArchived]
  );

  const newTemplate = () => {
    setEditing({
      id: "",
      name: "New form",
      stage: "planning",
      description: "",
      schema: [],
      is_active: true,
      is_archived: false,
      created_by: null,
      updated_at: new Date().toISOString(),
    });
  };

  const duplicate = async (t: Template) => {
    const { data: user } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("questionnaire_templates")
      .insert({
        name: `${t.name ?? "Form"} (copy)`,
        stage: t.stage,
        description: t.description,
        schema: t.schema,
        is_active: false,
        is_archived: false,
        created_by: user.user?.id ?? null,
      })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    toast.success("Duplicated");
    setRows((r) => [data as any, ...r]);
  };

  const toggleArchive = async (t: Template) => {
    const { error } = await supabase
      .from("questionnaire_templates")
      .update({ is_archived: !t.is_archived, is_active: t.is_archived ? t.is_active : false })
      .eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const toggleActive = async (t: Template) => {
    const { error } = await supabase
      .from("questionnaire_templates")
      .update({ is_active: !t.is_active })
      .eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  if (loading) return <p className="font-serif italic text-primary">Loading templates…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {canEdit && (
          <button onClick={newTemplate} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 inline-flex items-center gap-2">
            <Plus size={14} /> New template
          </button>
        )}
      </div>

      <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold overflow-hidden">
        {visible.length === 0 ? (
          <p className="font-serif italic text-2xl text-primary text-center py-16">No templates yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background-alt/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Stage</th>
                <th className="px-4 py-3 text-left">Questions</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const count = Array.isArray(t.schema) ? t.schema.length : 0;
                return (
                  <tr key={t.id} className="border-t border-border hover:bg-background-alt/40">
                    <td className="px-4 py-3">
                      <button onClick={() => canEdit ? setEditing(t) : setPreviewing(t)} className="font-serif italic text-primary hover:text-magenta text-left">
                        {t.name ?? "Untitled"}
                      </button>
                      {t.description && <p className="text-[12px] text-muted-foreground truncate max-w-[380px]">{t.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.stage ?? "—"}</td>
                    <td className="px-4 py-3 text-foreground">{count}</td>
                    <td className="px-4 py-3">
                      {t.is_archived ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-muted text-muted-foreground">Archived</span>
                      ) : t.is_active ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-sage/20 text-sage">Active</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-gold/20 text-gold">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <IconBtn title="Preview" onClick={() => setPreviewing(t)}><Eye size={14} /></IconBtn>
                        {canEdit && <IconBtn title="Edit" onClick={() => setEditing(t)}><Pencil size={14} /></IconBtn>}
                        {canEdit && <IconBtn title="Duplicate" onClick={() => duplicate(t)}><Copy size={14} /></IconBtn>}
                        {canEdit && !t.is_archived && (
                          <IconBtn title={t.is_active ? "Deactivate" : "Activate"} onClick={() => toggleActive(t)}>
                            {t.is_active ? "◐" : "○"}
                          </IconBtn>
                        )}
                        {canEdit && (
                          <IconBtn title={t.is_archived ? "Unarchive" : "Archive"} onClick={() => toggleArchive(t)}>
                            {t.is_archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
        />
      )}
      {previewing && (
        <TemplatePreview template={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-background-alt text-muted-foreground hover:text-primary">
      {children}
    </button>
  );
}

// -------------------------- Editor --------------------------

function TemplateEditor({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(template.name ?? "");
  const [stage, setStage] = useState(template.stage ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [isActive, setIsActive] = useState(!!template.is_active);
  const [schema, setSchema] = useState<QuestionDef[]>(Array.isArray(template.schema) ? template.schema : []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const updateQ = (i: number, patch: Partial<QuestionDef>) => {
    setSchema((s) => s.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  };
  const removeQ = (i: number) => setSchema((s) => s.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    setSchema((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };
  const addQ = (type: QuestionDef["type"]) => {
    const def = QUESTION_TYPES.find((t) => t.value === type)!;
    const q: QuestionDef = {
      id: `${slugify(type)}_${schema.length + 1}`,
      type,
      label: type === "section_header" ? "New section" : "New question",
      ...(def.hasOptions ? { options: ["Option 1"] } : {}),
    };
    setSchema((s) => [...s, q]);
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    // Validate select options
    for (const q of schema) {
      if ((q.type === "single_select" || q.type === "multi_select") && (!q.options || q.options.length === 0)) {
        toast.error(`"${q.label}" needs at least one option`);
        return;
      }
    }
    if (schema.length === 0) {
      const ok = window.confirm("This template has no questions. Save anyway?");
      if (!ok) return;
    }
    setSaving(true);
    const finalSchema = ensureIds(schema);
    const payload: any = {
      name: name.trim(),
      stage: stage || null,
      description: description || null,
      is_active: isActive,
      schema: finalSchema,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (template.id) {
      ({ error } = await supabase.from("questionnaire_templates").update(payload).eq("id", template.id));
    } else {
      const { data: user } = await supabase.auth.getUser();
      payload.created_by = user.user?.id ?? null;
      ({ error } = await supabase.from("questionnaire_templates").insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    await onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[880px] max-h-screen md:max-h-[92vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 z-10 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between gap-3">
          <h2 className="font-serif italic text-xl text-primary">{template.id ? "Edit template" : "New template"}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreviewOpen(true)} className="text-sm text-primary underline hover:text-magenta inline-flex items-center gap-1">
              <Eye size={14} /> Preview
            </button>
            <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Stage</span>
              <input list="stages" value={stage} onChange={(e) => setStage(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm" />
              <datalist id="stages">{STAGES.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif italic text-lg text-primary">Questions</h3>
              <span className="text-xs text-muted-foreground">{schema.length} total</span>
            </div>

            <div className="space-y-3">
              {schema.map((q, i) => (
                <QuestionEditorRow
                  key={i}
                  q={q}
                  index={i}
                  total={schema.length}
                  allIds={schema.map((x) => ({ id: x.id, label: x.label }))}
                  onChange={(p) => updateQ(i, p)}
                  onRemove={() => removeQ(i)}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {QUESTION_TYPES.map((t) => (
                <button key={t.value} onClick={() => addQ(t.value)} className="border border-dashed border-gold text-gold px-3 py-1.5 rounded-md text-xs hover:bg-gold/10">
                  + {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {previewOpen && (
        <TemplatePreview
          template={{ ...template, name, description, schema: ensureIds(schema) }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function QuestionEditorRow({
  q, index, total, allIds, onChange, onRemove, onUp, onDown,
}: {
  q: QuestionDef;
  index: number;
  total: number;
  allIds: { id: string; label: string }[];
  onChange: (p: Partial<QuestionDef>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const def = QUESTION_TYPES.find((t) => t.value === q.type) ?? QUESTION_TYPES[0];
  const cls = "w-full px-3 py-2 bg-background border border-border rounded-md text-sm";
  const [showCond, setShowCond] = useState(!!q.conditional);

  return (
    <div className="bg-background-alt/30 rounded-md border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">#{index + 1}</span>
        <select value={q.type} onChange={(e) => onChange({ type: e.target.value as any, options: undefined, required: false })} className="px-2 py-1 border border-border rounded-md text-xs bg-background">
          {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <IconBtn title="Move up" onClick={onUp}>{index === 0 ? <span className="opacity-30"><ArrowUp size={14} /></span> : <ArrowUp size={14} />}</IconBtn>
          <IconBtn title="Move down" onClick={onDown}>{index === total - 1 ? <span className="opacity-30"><ArrowDown size={14} /></span> : <ArrowDown size={14} />}</IconBtn>
          <IconBtn title="Delete" onClick={onRemove}><Trash2 size={14} /></IconBtn>
        </div>
      </div>

      <label className="text-sm block">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Label</span>
        <input value={q.label} onChange={(e) => onChange({ label: e.target.value })} className={cls} />
      </label>

      <label className="text-sm block">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Helper text (optional)</span>
        <input value={q.helper ?? ""} onChange={(e) => onChange({ helper: e.target.value })} className={cls} />
      </label>

      <label className="text-sm block">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Field id</span>
        <input value={q.id} onChange={(e) => onChange({ id: e.target.value })} className={cls + " font-mono text-xs"} />
      </label>

      {!def.noRequired && !def.composite && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!q.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Required
        </label>
      )}

      {def.hasOptions && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Options</p>
          <OptionsEditor options={q.options ?? []} onChange={(options) => onChange({ options })} />
        </div>
      )}

      {def.composite && (
        <p className="text-[12px] text-muted-foreground italic">This is a composite field with fixed internal behavior. Only its label, helper, and position are editable.</p>
      )}

      <div>
        <button onClick={() => { setShowCond(!showCond); if (showCond) onChange({ conditional: undefined }); }} className="text-[12px] text-primary hover:text-magenta underline">
          {showCond ? "Remove conditional" : "+ Add conditional (show if…)"}
        </button>
        {showCond && (
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            <select value={q.conditional?.on ?? ""} onChange={(e) => onChange({ conditional: { on: e.target.value, equals: q.conditional?.equals ?? "" } })} className={cls}>
              <option value="">Depends on question…</option>
              {allIds.filter((x) => x.id !== q.id).map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
            </select>
            <input placeholder="Equals value" value={q.conditional?.equals ?? ""} onChange={(e) => onChange({ conditional: { on: q.conditional?.on ?? "", equals: e.target.value } })} className={cls} />
          </div>
        )}
      </div>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={o} onChange={(e) => onChange(options.map((x, idx) => idx === i ? e.target.value : x))} className="flex-1 px-2 py-1.5 bg-background border border-border rounded-md text-sm" />
          <IconBtn title="Up" onClick={() => { if (i === 0) return; const n = [...options]; [n[i-1], n[i]] = [n[i], n[i-1]]; onChange(n); }}><ArrowUp size={12} /></IconBtn>
          <IconBtn title="Down" onClick={() => { if (i === options.length - 1) return; const n = [...options]; [n[i+1], n[i]] = [n[i], n[i+1]]; onChange(n); }}><ArrowDown size={12} /></IconBtn>
          <IconBtn title="Remove" onClick={() => onChange(options.filter((_, idx) => idx !== i))}><Trash2 size={12} /></IconBtn>
        </div>
      ))}
      <button onClick={() => onChange([...options, `Option ${options.length + 1}`])} className="border border-dashed border-gold text-gold px-3 py-1 rounded-md text-xs hover:bg-gold/10">
        + Add option
      </button>
    </div>
  );
}

// -------------------------- Preview (reuses portal FieldRow) --------------------------

function TemplatePreview({ template, onClose }: { template: Template; onClose: () => void }) {
  const [responses, setResponses] = useState<Record<string, any>>({});
  const schema: QuestionDef[] = Array.isArray(template.schema) ? template.schema : [];

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[720px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 z-10 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Preview (couple view)</p>
            <h2 className="font-serif italic text-xl text-primary">{template.name ?? "Form"}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 md:px-10 py-8">
          {template.description && <p className="text-sm text-muted-foreground mb-6">{template.description}</p>}
          {schema.length === 0 ? (
            <p className="font-serif italic text-muted-foreground">This form has no questions yet.</p>
          ) : (
            <div className="space-y-7">
              {schema
                .filter((q) => !q.conditional || responses[q.conditional.on] === q.conditional.equals)
                .map((q) => (
                  <FieldErrorBoundary key={q.id} questionId={q.id} questionType={q.type}>
                    <FieldRow
                      q={q}
                      value={responses[q.id]}
                      readOnly={false}
                      onChange={(v) => setResponses((r) => ({ ...r, [q.id]: v }))}
                      registerRef={() => {}}
                    />
                  </FieldErrorBoundary>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
