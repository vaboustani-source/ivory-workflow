import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  base_price: number | null;
  default_hours: number | null;
  is_active: boolean | null;
  add_processing_fees: boolean;
  default_payment_schedule_template_id: string | null;
}

interface TemplateOption { id: string; name: string; installments: number }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  pkg: PackageRow | null;
}

export function PackageEditorModal({ open, onClose, onSaved, pkg }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState<string>("");
  const [defaultHours, setDefaultHours] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [addProcessingFees, setAddProcessingFees] = useState(false);
  const [defaultScheduleId, setDefaultScheduleId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: tpls } = await supabase
        .from("payment_schedule_templates")
        .select("id,name,payment_schedule_template_installments(id)")
        .eq("is_active", true)
        .order("name");
      setTemplates(
        (tpls ?? []).map((t: any) => ({
          id: t.id,
          name: t.name,
          installments: (t.payment_schedule_template_installments ?? []).length,
        }))
      );
      if (pkg) {
        setName(pkg.name);
        setDescription(pkg.description ?? "");
        setBasePrice(pkg.base_price != null ? String(pkg.base_price) : "");
        setDefaultHours(pkg.default_hours != null ? String(pkg.default_hours) : "");
        setIsActive(pkg.is_active ?? true);
        setAddProcessingFees(pkg.add_processing_fees ?? false);
        setDefaultScheduleId(pkg.default_payment_schedule_template_id);
      } else {
        setName(""); setDescription(""); setBasePrice(""); setDefaultHours("");
        setIsActive(true); setAddProcessingFees(false); setDefaultScheduleId(null);
      }
    })();
  }, [open, pkg]);

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        base_price: basePrice ? Number(basePrice) : null,
        default_hours: defaultHours ? Number(defaultHours) : null,
        is_active: isActive,
        add_processing_fees: addProcessingFees,
        default_payment_schedule_template_id: defaultScheduleId,
      };
      if (pkg) {
        const { error } = await supabase.from("packages").update(payload).eq("id", pkg.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("packages").insert(payload);
        if (error) throw error;
      }
      toast.success(pkg ? "Package saved" : "Package created");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save package");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const showFeeNote = addProcessingFees && !defaultScheduleId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(65,25,40,0.45)" }}>
      <div className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-lg" style={{ background: "var(--sbv-pink-soft)" }}>
        <div className="flex items-center justify-between px-7 pt-6 pb-2">
          <h2 className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>
            {pkg ? "Edit package" : "New package"}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--sbv-purple)" }} className="opacity-70 hover:opacity-100">
            <X size={20} />
          </button>
        </div>

        <div className="px-7 py-5 space-y-6">
          {/* Basics */}
          <section className="space-y-4">
            <div>
              <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>
                Name <span style={{ color: "var(--sbv-fuchsia)" }}>*</span>
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-sm bg-white/85 outline-none focus:ring-2 text-sm"
                style={{ color: "var(--sbv-purple)" }} placeholder="e.g. Signature wedding" />
            </div>
            <div>
              <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className="w-full px-3 py-2 rounded-sm bg-white/85 outline-none focus:ring-2 text-sm"
                style={{ color: "var(--sbv-purple)" }} />
            </div>
          </section>

          {/* Pricing */}
          <section className="pt-5 border-t" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-lg mb-3" style={{ color: "var(--sbv-green)" }}>Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>Base price ($)</label>
                <input type="number" min={0} step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm bg-white/85 outline-none focus:ring-2 text-sm"
                  style={{ color: "var(--sbv-purple)" }} />
              </div>
              <div>
                <label className="font-serif text-sm block mb-1.5" style={{ color: "var(--sbv-green)" }}>Default hours</label>
                <input type="number" min={0} step="0.5" value={defaultHours} onChange={(e) => setDefaultHours(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm bg-white/85 outline-none focus:ring-2 text-sm"
                  style={{ color: "var(--sbv-purple)" }} />
              </div>
            </div>
          </section>

          {/* Invoicing */}
          <section className="pt-5 border-t" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-lg mb-4" style={{ color: "var(--sbv-green)" }}>Invoicing</h3>

            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between gap-4">
                <label className="font-serif text-sm" style={{ color: "var(--sbv-green)" }}>Processing fees</label>
                <Switch
                  checked={addProcessingFees}
                  onCheckedChange={setAddProcessingFees}
                  className="data-[state=checked]:!bg-[var(--sbv-green)] data-[state=unchecked]:!bg-[var(--sbv-ivory)]"
                />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#6B6B6B" }}>
                When on, Stripe processing fees are added to each installment so you receive your full package price.
                Clients see one total — fees are baked in, never shown as a line item.
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-serif text-sm block" style={{ color: "var(--sbv-green)" }}>Default payment schedule</label>
              <select
                value={defaultScheduleId ?? ""}
                onChange={(e) => setDefaultScheduleId(e.target.value || null)}
                className="w-full px-3 py-2 rounded-sm bg-white/85 outline-none text-sm"
                style={{ color: "var(--sbv-purple)" }}
              >
                <option value="">— None (manual selection per booking) —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.installments} installment{t.installments === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
              <p className="text-xs leading-relaxed" style={{ color: "#6B6B6B" }}>
                Used to auto-generate invoices when an inquiry moves to booked. Studio can override per client.
              </p>
              {showFeeNote && (
                <p className="text-xs italic mt-2" style={{ color: "var(--sbv-purple)" }}>
                  You can still bake fees into manually-created invoices. Set a default schedule to enable
                  auto-generation on booking.
                </p>
              )}
            </div>
          </section>

          {/* Active */}
          <section className="pt-5 border-t flex items-center justify-between" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <label className="font-serif text-sm" style={{ color: "var(--sbv-green)" }}>Active</label>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              className="data-[state=checked]:!bg-[var(--sbv-green)] data-[state=unchecked]:!bg-[var(--sbv-ivory)]"
            />
          </section>
        </div>

        <div className="px-7 py-5 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm font-medium hover:underline" style={{ color: "var(--sbv-purple)" }}>
            Cancel
          </button>
          <button
            disabled={!canSave}
            onClick={handleSave}
            className="px-5 py-2 rounded-sm text-sm font-medium text-white disabled:opacity-40 transition-opacity"
            style={{ background: "var(--sbv-green)" }}
          >
            {saving ? "Saving…" : pkg ? "Save changes" : "Create package"}
          </button>
        </div>
      </div>
    </div>
  );
}
