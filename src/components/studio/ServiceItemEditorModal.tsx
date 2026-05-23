import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export type ServiceItemType =
  | "wedding_package" | "engagement_session" | "portrait_session" | "album"
  | "videography" | "print" | "add_on" | "deliverable" | "travel" | "custom";

export type ServiceItemUnit = "flat" | "per_hour" | "per_mile" | "per_person" | "per_unit";

export interface ServiceItemRow {
  id: string;
  name: string;
  description: string | null;
  item_type: ServiceItemType;
  price_cents: number | null;
  unit: ServiceItemUnit;
  coverage_hours: number | null;
  is_active: boolean;
  display_order: number | null;
  is_taxable: boolean | null;
}

export const ITEM_TYPE_LABELS: Record<ServiceItemType, string> = {
  wedding_package: "Wedding package",
  engagement_session: "Engagement session",
  portrait_session: "Portrait session",
  album: "Album",
  videography: "Videography",
  print: "Print",
  add_on: "Add-on",
  deliverable: "Deliverable",
  travel: "Travel",
  custom: "Custom",
};

export const UNIT_LABELS: Record<ServiceItemUnit, string> = {
  flat: "Flat",
  per_hour: "Per hour",
  per_mile: "Per mile",
  per_person: "Per person",
  per_unit: "Per unit",
};

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as ServiceItemType[];
const UNITS = Object.keys(UNIT_LABELS) as ServiceItemUnit[];

interface Inclusion {
  id?: string; // package_default_inclusions row id (if persisted)
  included_item_id: string;
  included_item_name: string;
  quantity: number;
}

interface Bullet {
  id?: string; // service_item_inclusions row id (persisted)
  text: string;
  display_order: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  item: ServiceItemRow | null;
  allItems: ServiceItemRow[]; // for inclusion picker
  hourlyCoverageRateCents?: number | null;
}

const inputCls =
  "w-full px-3 py-2 rounded-sm bg-white/85 outline-none focus:ring-2 text-sm";
const labelCls = "font-serif text-sm block mb-1.5";

function fmtMoney(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(cents) / 100;
  return `${sign}$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function ServiceItemEditorModal({ open, onClose, onSaved, item, allItems, hourlyCoverageRateCents: propRate }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState<ServiceItemType>("wedding_package");
  const [isActive, setIsActive] = useState(true);

  const [priceStr, setPriceStr] = useState("");
  const [unit, setUnit] = useState<ServiceItemUnit>("flat");
  const [coverageHoursStr, setCoverageHoursStr] = useState("");


  const [inclusions, setInclusions] = useState<Inclusion[]>([]);
  const [addInclusionId, setAddInclusionId] = useState<string>("");

  const [bullets, setBullets] = useState<Bullet[]>([]);

  const [hourlyCoverageRateCents, setHourlyCoverageRateCents] = useState<number | null>(propRate ?? null);

  // Sync when parent passes an updated rate while modal is open
  useEffect(() => {
    if (propRate !== undefined) {
      setHourlyCoverageRateCents(propRate);
    }
  }, [propRate]);

  const [saving, setSaving] = useState(false);

  // Load when opening
  useEffect(() => {
    if (!open) return;
    (async () => {
      // hourly coverage rate — only fetch internally if parent didn't pass a rate
      if (propRate === undefined) {
        const { data: inv } = await supabase
          .from("studio_invoicing_settings")
          .select("hourly_coverage_rate_cents")
          .maybeSingle();
        setHourlyCoverageRateCents((inv as any)?.hourly_coverage_rate_cents ?? null);
      }

      if (item) {
        setName(item.name);
        setDescription(item.description ?? "");
        setItemType(item.item_type);
        setIsActive(item.is_active);
        setPriceStr(item.price_cents != null ? String(item.price_cents / 100) : "");
        setUnit(item.unit);
        setCoverageHoursStr(item.coverage_hours != null ? String(item.coverage_hours) : "");


        // inclusions
        const { data: incs } = await supabase
          .from("package_default_inclusions")
          .select("id,included_item_id,quantity,service_items!package_default_inclusions_included_item_id_fkey(name)")
          .eq("package_item_id", item.id);
        setInclusions(
          ((incs ?? []) as any[]).map((r) => ({
            id: r.id,
            included_item_id: r.included_item_id,
            included_item_name: r.service_items?.name ?? "(item)",
            quantity: r.quantity ?? 1,
          })),
        );

        // bullets ("what's included")
        const { data: bs } = await (supabase as any)
          .from("service_item_inclusions")
          .select("id,text,display_order")
          .eq("service_item_id", item.id)
          .order("display_order");
        setBullets(((bs ?? []) as any[]).map((r) => ({
          id: r.id, text: r.text, display_order: r.display_order ?? 0,
        })));
      } else {
        setName(""); setDescription(""); setItemType("wedding_package"); setIsActive(true);
        setPriceStr(""); setUnit("flat"); setCoverageHoursStr("");
        
        setInclusions([]);
        setBullets([]);
      }
      setAddInclusionId("");
    })();
  }, [open, item]);

  const priceCents = priceStr ? Math.round(Number(priceStr) * 100) : 0;
  const costCents = costStr ? Math.round(Number(costStr) * 100) : 0;
  const hasMargin = priceStr !== "" && costStr !== "";
  const marginCents = priceCents - costCents;
  const marginPct = priceCents > 0 ? (marginCents / priceCents) * 100 : 0;
  const marginPositive = marginCents >= 0;

  const isPackage = itemType === "wedding_package";

  const suggestedPriceCents = useMemo(() => {
    if (!isPackage) return null;
    if (!hourlyCoverageRateCents) return null;
    const hrs = Number(coverageHoursStr);
    if (!hrs || hrs <= 0) return null;
    return Math.round(hrs * hourlyCoverageRateCents);
  }, [isPackage, hourlyCoverageRateCents, coverageHoursStr]);

  const inclusionCandidates = useMemo(
    () =>
      allItems.filter(
        (i) =>
          i.is_active &&
          i.id !== item?.id &&
          i.item_type !== "wedding_package" &&
          !inclusions.some((inc) => inc.included_item_id === i.id),
      ),
    [allItems, item?.id, inclusions],
  );

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        item_type: itemType,
        price_cents: priceStr ? priceCents : 0,
        unit,
        coverage_hours: isPackage && coverageHoursStr ? Number(coverageHoursStr) : null,
        is_active: isActive,
      };

      let itemId = item?.id;
      if (item) {
        const { error } = await supabase.from("service_items").update(payload).eq("id", item.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("service_items")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        itemId = data!.id;
      }

      // Upsert cost row
      try {
        const costPayload = {
          service_item_id: itemId!,
          cost_cents: costStr ? costCents : 0,
          cost_type: costType,
          estimated_labor_hours: laborHoursStr ? Number(laborHoursStr) : null,
          cost_notes: costNotes.trim() || null,
        };
        const { error: costErr } = await supabase
          .from("service_item_costs")
          .upsert(costPayload, { onConflict: "service_item_id" });
        if (costErr) throw costErr;
      } catch (e: any) {
        toast.error(`Item saved, but cost did not save: ${e.message ?? e}`);
      }

      // Sync inclusions (only meaningful for packages)
      if (isPackage) {
        const { data: existing } = await supabase
          .from("package_default_inclusions")
          .select("id,included_item_id,quantity")
          .eq("package_item_id", itemId!);
        const existingArr = (existing ?? []) as { id: string; included_item_id: string; quantity: number }[];

        const desiredIds = new Set(inclusions.map((i) => i.included_item_id));
        const toDelete = existingArr.filter((e) => !desiredIds.has(e.included_item_id)).map((e) => e.id);
        if (toDelete.length) {
          await supabase.from("package_default_inclusions").delete().in("id", toDelete);
        }
        for (const inc of inclusions) {
          const match = existingArr.find((e) => e.included_item_id === inc.included_item_id);
          if (!match) {
            await supabase.from("package_default_inclusions").insert({
              package_item_id: itemId!,
              included_item_id: inc.included_item_id,
              quantity: inc.quantity,
            });
          } else if (match.quantity !== inc.quantity) {
            await supabase
              .from("package_default_inclusions")
              .update({ quantity: inc.quantity })
              .eq("id", match.id);
          }
        }
      } else {
        // Non-package: ensure no inclusions linger
        await supabase.from("package_default_inclusions").delete().eq("package_item_id", itemId!);
      }

      // Sync "What's included" bullets (all item types)
      {
        const cleaned = bullets
          .map((b, idx) => ({ ...b, text: b.text.trim(), display_order: idx }))
          .filter((b) => b.text.length > 0);
        const { data: existingBs } = await (supabase as any)
          .from("service_item_inclusions")
          .select("id")
          .eq("service_item_id", itemId!);
        const existingIds = new Set(((existingBs ?? []) as { id: string }[]).map((r) => r.id));
        const keepIds = new Set(cleaned.filter((b) => b.id).map((b) => b.id!));
        const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
        if (toDelete.length) {
          await (supabase as any).from("service_item_inclusions").delete().in("id", toDelete);
        }
        for (const b of cleaned) {
          if (b.id) {
            await (supabase as any).from("service_item_inclusions")
              .update({ text: b.text, display_order: b.display_order })
              .eq("id", b.id);
          } else {
            await (supabase as any).from("service_item_inclusions").insert({
              service_item_id: itemId!,
              text: b.text,
              display_order: b.display_order,
            });
          }
        }
      }


      toast.success(item ? "Service item updated" : "Service item created");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(65,25,40,0.45)" }}>
      <div className="w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-lg" style={{ background: "var(--sbv-pink)" }}>
        <div className="flex items-center justify-between px-7 pt-6 pb-2">
          <h2 className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>
            {item ? "Edit service item" : "New service item"}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--sbv-purple)" }} className="opacity-70 hover:opacity-100">
            <X size={20} />
          </button>
        </div>

        <div className="px-7 py-5 space-y-6">
          {/* Details */}
          <section className="space-y-4">
            <h3 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Details</h3>
            <div>
              <label className={labelCls} style={{ color: "var(--sbv-green)" }}>
                Name <span style={{ color: "var(--sbv-fuchsia)" }}>*</span>
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className={inputCls} style={{ color: "var(--sbv-purple)" }}
                placeholder="e.g. Signature wedding" />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className={inputCls} style={{ color: "var(--sbv-purple)" }} />
            </div>
            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Type</label>
                <select value={itemType} onChange={(e) => setItemType(e.target.value as ServiceItemType)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-4 pb-1">
                <label className="font-serif text-sm" style={{ color: "var(--sbv-green)" }}>Active</label>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  className="data-[state=checked]:!bg-[var(--sbv-green)] data-[state=unchecked]:!bg-[var(--sbv-ivory)]"
                />
              </div>
            </div>
          </section>

          {/* Pricing */}
          <section className="pt-5 border-t space-y-4" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Price ($)</label>
                <input type="number" min={0} step="0.01" value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Unit</label>
                <select value={unit} onChange={(e) => setUnit(e.target.value as ServiceItemUnit)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                </select>
              </div>
            </div>
            {isPackage && (
              <div className="grid grid-cols-2 gap-4 items-end">
                <div>
                  <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Coverage hours</label>
                  <input type="number" min={0} step="0.5" value={coverageHoursStr}
                    onChange={(e) => setCoverageHoursStr(e.target.value)}
                    className={inputCls} style={{ color: "var(--sbv-purple)" }} />
                </div>
                {suggestedPriceCents != null && (
                  <button
                    type="button"
                    onClick={() => setPriceStr(String(suggestedPriceCents / 100))}
                    className="text-sm underline pb-2 text-left"
                    style={{ color: "var(--sbv-purple)" }}
                  >
                    Suggest price: {fmtMoney(suggestedPriceCents)} ({coverageHoursStr}h × {fmtMoney(hourlyCoverageRateCents!)}/hr)
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Cost & margin (owner-only section; modal itself is owner-only) */}
          <section className="pt-5 border-t space-y-4" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Cost &amp; margin</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Cost ($)</label>
                <input type="number" min={0} step="0.01" value={costStr}
                  onChange={(e) => setCostStr(e.target.value)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }} />
              </div>
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Cost type</label>
                <select value={costType} onChange={(e) => setCostType(e.target.value as ServiceItemUnit)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Estimated labor hours</label>
                <input type="number" min={0} step="0.25" value={laborHoursStr}
                  onChange={(e) => setLaborHoursStr(e.target.value)}
                  className={inputCls} style={{ color: "var(--sbv-purple)" }} />
              </div>
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--sbv-green)" }}>Cost notes</label>
              <textarea value={costNotes} onChange={(e) => setCostNotes(e.target.value)} rows={2}
                className={inputCls} style={{ color: "var(--sbv-purple)" }} />
            </div>
            {hasMargin && (
              <div
                className="font-serif text-base"
                style={{ color: marginPositive ? "var(--sbv-green)" : "var(--sbv-fuchsia)" }}
              >
                Margin: {fmtMoney(marginCents)} ({marginPct.toFixed(0)}%)
              </div>
            )}
          </section>

          {/* Default inclusions — packages only */}
          {isPackage && (
            <section className="pt-5 border-t space-y-3" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
              <h3 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Default inclusions</h3>
              <p className="text-xs leading-relaxed" style={{ color: "#6B6B6B" }}>
                These items auto-populate when this package is added to a quote. The couple can still add or remove items.
              </p>

              {inclusions.length > 0 && (
                <div className="space-y-2">
                  {inclusions.map((inc, idx) => (
                    <div key={inc.included_item_id} className="flex items-center gap-3 px-3 py-2 rounded-sm bg-white/70">
                      <div className="flex-1 text-sm" style={{ color: "var(--sbv-purple)" }}>
                        {inc.included_item_name}
                      </div>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={inc.quantity}
                        onChange={(e) => {
                          const q = Math.max(1, Number(e.target.value) || 1);
                          setInclusions((arr) => arr.map((x, i) => (i === idx ? { ...x, quantity: q } : x)));
                        }}
                        className="w-20 px-2 py-1 rounded-sm bg-white/85 text-sm outline-none"
                        style={{ color: "var(--sbv-purple)" }}
                      />
                      <button
                        type="button"
                        onClick={() => setInclusions((arr) => arr.filter((_, i) => i !== idx))}
                        aria-label="Remove inclusion"
                        style={{ color: "var(--sbv-purple)" }}
                        className="opacity-70 hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <select
                  value={addInclusionId}
                  onChange={(e) => setAddInclusionId(e.target.value)}
                  className={inputCls}
                  style={{ color: "var(--sbv-purple)" }}
                >
                  <option value="">Add an item that comes bundled with this package…</option>
                  {inclusionCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {ITEM_TYPE_LABELS[c.item_type]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addInclusionId}
                  onClick={() => {
                    const c = inclusionCandidates.find((i) => i.id === addInclusionId);
                    if (!c) return;
                    setInclusions((arr) => [
                      ...arr,
                      { included_item_id: c.id, included_item_name: c.name, quantity: 1 },
                    ]);
                    setAddInclusionId("");
                  }}
                  className="px-3 py-2 rounded-sm text-sm text-white disabled:opacity-40 inline-flex items-center gap-1"
                  style={{ background: "var(--sbv-green)" }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            </section>
          )}

          {/* What's included — all item types */}
          <section className="pt-5 border-t space-y-3" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>What's included</h3>
            <p className="text-xs leading-relaxed" style={{ color: "#6B6B6B" }}>
              Descriptive bullets shown on the quote (and later the contract). These appear by default when this item is added to a quote — you can customize them per couple.
            </p>

            {bullets.length > 0 && (
              <div className="space-y-2">
                {bullets.map((b, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => setBullets((arr) => {
                          const copy = [...arr];
                          [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                          return copy;
                        })}
                        className="text-[10px] leading-none opacity-60 hover:opacity-100 disabled:opacity-20"
                        style={{ color: "var(--sbv-purple)" }}
                        aria-label="Move up"
                      >▲</button>
                      <button
                        type="button"
                        disabled={idx === bullets.length - 1}
                        onClick={() => setBullets((arr) => {
                          const copy = [...arr];
                          [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                          return copy;
                        })}
                        className="text-[10px] leading-none opacity-60 hover:opacity-100 disabled:opacity-20"
                        style={{ color: "var(--sbv-purple)" }}
                        aria-label="Move down"
                      >▼</button>
                    </div>
                    <input
                      type="text"
                      value={b.text}
                      onChange={(e) => setBullets((arr) => arr.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))}
                      className={inputCls}
                      style={{ color: "var(--sbv-purple)" }}
                      placeholder="e.g. 8 hours of coverage"
                    />
                    <button
                      type="button"
                      onClick={() => setBullets((arr) => arr.filter((_, i) => i !== idx))}
                      aria-label="Remove bullet"
                      style={{ color: "var(--sbv-purple)" }}
                      className="opacity-70 hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setBullets((arr) => [...arr, { text: "", display_order: arr.length }])}
              className="px-3 py-2 rounded-sm text-sm inline-flex items-center gap-1 foil-gold border"
              style={{ borderColor: "var(--sbv-purple)", color: "var(--sbv-purple)", background: "transparent" }}
            >
              <Plus size={14} /> Add inclusion
            </button>
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
            {saving ? "Saving…" : item ? "Save changes" : "Create item"}
          </button>
        </div>
      </div>
    </div>
  );
}
