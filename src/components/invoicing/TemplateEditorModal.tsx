import { useEffect, useMemo, useState } from "react";
import { GripVertical, Trash2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type DueOffsetType = "on_booking" | "days_after_booking" | "days_before_event";

export interface Installment {
  id?: string;
  label: string;
  percentage: number;
  due_offset_type: DueOffsetType;
  due_offset_days: number | null;
}

export interface TemplateRecord {
  id: string;
  name: string;
  package_id: string | null;
  is_active: boolean;
}

interface PackageOption { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  template: TemplateRecord | null; // null = creating new
  packages: PackageOption[];
}

const OFFSET_LABELS: Record<DueOffsetType, string> = {
  on_booking: "On booking",
  days_after_booking: "Days after booking",
  days_before_event: "Days before event",
};

function emptyInstallment(): Installment {
  return { label: "", percentage: 0, due_offset_type: "on_booking", due_offset_days: null };
}

export function TemplateEditorModal({ open, onClose, onSaved, template, packages }: Props) {
  const [name, setName] = useState("");
  const [packageId, setPackageId] = useState<string>("__global__");
  const [installments, setInstallments] = useState<Installment[]>([emptyInstallment()]);
  const [inUse, setInUse] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (template) {
        setName(template.name);
        setPackageId(template.package_id ?? "__global__");
        const { data: rows } = await supabase
          .from("payment_schedule_template_installments")
          .select("id,label,percentage,due_offset_type,due_offset_days,sequence_order")
          .eq("template_id", template.id)
          .order("sequence_order", { ascending: true });
        if (cancelled) return;
        setInstallments(
          (rows ?? []).map((r: any) => ({
            id: r.id,
            label: r.label,
            percentage: Number(r.percentage),
            due_offset_type: r.due_offset_type,
            due_offset_days: r.due_offset_days,
          }))
        );
        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("payment_schedule_template_id" as any, template.id);
        // payment_schedule_template_id may not exist on invoices yet; fall back silently
        setInUse((count ?? 0) > 0);
      } else {
        setName("");
        setPackageId("__global__");
        setInstallments([emptyInstallment()]);
        setInUse(false);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [open, template]);

  const total = useMemo(
    () => installments.reduce((s, r) => s + (Number.isFinite(r.percentage) ? r.percentage : 0), 0),
    [installments]
  );
  const totalRounded = Math.round(total * 100) / 100;
  const isHundred = totalRounded === 100;

  const updateRow = (idx: number, patch: Partial<Installment>) => {
    setInstallments((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () => setInstallments((rows) => [...rows, emptyInstallment()]);
  const removeRow = (idx: number) =>
    setInstallments((rows) => rows.filter((_, i) => i !== idx));

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (idx: number) => {
    if (dragIdx == null || dragIdx === idx) return;
    setInstallments((rows) => {
      const next = [...rows];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
  };

  const canSave = name.trim().length > 0 && isHundred && installments.every((r) => r.label.trim().length > 0) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const pkg = packageId === "__global__" ? null : packageId;
      const installmentsPayload = installments.map((r, i) => {
        const base: { sequence_order: number; label: string; percentage: number; due_offset_type: DueOffsetType; due_offset_days?: number } = {
          sequence_order: i,
          label: r.label.trim(),
          percentage: r.percentage,
          due_offset_type: r.due_offset_type,
        };
        if (r.due_offset_type !== "on_booking" && r.due_offset_days != null) {
          base.due_offset_days = r.due_offset_days;
        }
        return base;
      });

      if (!template) {
        // Create new
        const { data: created, error } = await supabase
          .from("payment_schedule_templates")
          .insert({ name: name.trim(), package_id: pkg, is_active: true })
          .select("id")
          .single();
        if (error) throw error;
        const tplId = created.id;
        const { error: e2 } = await supabase
          .from("payment_schedule_template_installments")
          .insert(installmentsPayload.map((p) => ({ ...p, template_id: tplId })));
        if (e2) throw e2;
      } else if (inUse) {
        // Versioning: deactivate old, create new
        const { data: created, error } = await supabase
          .from("payment_schedule_templates")
          .insert({ name: name.trim(), package_id: pkg, is_active: true })
          .select("id")
          .single();
        if (error) throw error;
        const tplId = created.id;
        const { error: e2 } = await supabase
          .from("payment_schedule_template_installments")
          .insert(installmentsPayload.map((p) => ({ ...p, template_id: tplId })));
        if (e2) throw e2;
        await supabase
          .from("payment_schedule_templates")
          .update({ is_active: false })
          .eq("id", template.id);
      } else {
        // Update in place
        const { error } = await supabase
          .from("payment_schedule_templates")
          .update({ name: name.trim(), package_id: pkg })
          .eq("id", template.id);
        if (error) throw error;
        // Replace installments
        await supabase
          .from("payment_schedule_template_installments")
          .delete()
          .eq("template_id", template.id);
        const { error: e2 } = await supabase
          .from("payment_schedule_template_installments")
          .insert(installmentsPayload.map((p) => ({ ...p, template_id: template.id })));
        if (e2) throw e2;
      }
      toast.success(template ? "Template saved" : "Template created");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(65, 25, 40, 0.45)" }}>
      <div
        className="w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-lg shadow-elevated"
        style={{ background: "var(--sbv-pink-soft)" }}
      >
        <div className="flex items-center justify-between px-7 pt-6 pb-2">
          <h2 className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>
            {template ? "Edit template" : "New template"}
          </h2>
          <button onClick={onClose} className="opacity-70 hover:opacity-100" style={{ color: "var(--sbv-purple)" }} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-7 py-5 space-y-5">
          <div>
            <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>
              Name <span style={{ color: "var(--sbv-fuchsia)" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard 3-payment"
              className="w-full px-3 py-2 rounded-sm bg-white/85 border-0 outline-none focus:ring-2 text-sm"
              style={{ color: "var(--sbv-purple)" }}
            />
          </div>

          <div>
            <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>
              Package association
            </label>
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="w-full px-3 py-2 rounded-sm bg-white/85 border-0 outline-none text-sm"
              style={{ color: "var(--sbv-purple)" }}
            >
              <option value="__global__">Global — available to all packages</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <h3 className="font-serif text-lg mb-3" style={{ color: "var(--sbv-green)" }}>Installments</h3>
            <div className="space-y-2">
              {installments.map((row, idx) => (
                <div
                  key={idx}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(idx)}
                  className="flex items-center gap-2 bg-white/70 rounded-sm px-2 py-2"
                >
                  <button
                    type="button"
                    className="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100"
                    style={{ color: "var(--sbv-purple)" }}
                    aria-label="Drag to reorder"
                  >
                    <GripVertical size={16} />
                  </button>
                  <input
                    value={row.label}
                    onChange={(e) => updateRow(idx, { label: e.target.value })}
                    placeholder="Label (e.g. Retainer)"
                    className="flex-1 min-w-[100px] px-2 py-1.5 bg-white rounded-sm text-sm outline-none focus:ring-2"
                    style={{ color: "var(--sbv-purple)" }}
                  />
                  <div className="relative w-[88px]">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={Number.isFinite(row.percentage) ? row.percentage : 0}
                      onChange={(e) => updateRow(idx, { percentage: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-2 pr-6 py-1.5 bg-white rounded-sm text-sm outline-none focus:ring-2"
                      style={{ color: "var(--sbv-purple)" }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-60" style={{ color: "var(--sbv-purple)" }}>%</span>
                  </div>
                  <select
                    value={row.due_offset_type}
                    onChange={(e) =>
                      updateRow(idx, {
                        due_offset_type: e.target.value as DueOffsetType,
                        due_offset_days: e.target.value === "on_booking" ? null : (row.due_offset_days ?? 0),
                      })
                    }
                    className="px-2 py-1.5 bg-white rounded-sm text-sm outline-none"
                    style={{ color: "var(--sbv-purple)" }}
                  >
                    {(Object.keys(OFFSET_LABELS) as DueOffsetType[]).map((k) => (
                      <option key={k} value={k}>{OFFSET_LABELS[k]}</option>
                    ))}
                  </select>
                  {row.due_offset_type !== "on_booking" && (
                    <input
                      type="number"
                      min={0}
                      value={row.due_offset_days ?? 0}
                      onChange={(e) => updateRow(idx, { due_offset_days: parseInt(e.target.value) || 0 })}
                      className="w-[72px] px-2 py-1.5 bg-white rounded-sm text-sm outline-none focus:ring-2"
                      style={{ color: "var(--sbv-purple)" }}
                      title="Days"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={installments.length === 1}
                    className="px-2 text-xs hover:underline disabled:opacity-30"
                    style={{ color: "var(--sbv-purple)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm foil-gold-border transition-colors hover:foil-gold-bg group"
              style={{ color: "var(--sbv-purple)" }}
            >
              <Plus size={14} />
              <span className="font-medium">Add installment</span>
            </button>
          </div>

          <div className="pt-1 text-right">
            {isHundred ? (
              <p className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>
                Total: 100% ✓
              </p>
            ) : (
              <p className="font-serif text-base" style={{ color: "var(--sbv-purple)" }}>
                Total: {totalRounded}% — must equal 100%
              </p>
            )}
          </div>

          {template && inUse && (
            <p className="text-xs italic" style={{ color: "var(--sbv-purple)" }}>
              This template is in use. Saving will create a new version. Existing invoices keep their original schedule.
            </p>
          )}
        </div>

        <div className="px-7 py-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--sbv-purple)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className="px-5 py-2 rounded-sm text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: "var(--sbv-green)" }}
          >
            {saving ? "Saving…" : template ? "Save changes" : "Create template"}
          </button>
        </div>
      </div>
    </div>
  );
}
