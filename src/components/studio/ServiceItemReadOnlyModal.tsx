import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ITEM_TYPE_LABELS, UNIT_LABELS, type ServiceItemRow } from "./ServiceItemEditorModal";

interface Props {
  open: boolean;
  onClose: () => void;
  item: ServiceItemRow | null;
}

interface Inclusion { name: string; quantity: number }
interface Bullet { text: string }

export function ServiceItemReadOnlyModal({ open, onClose, item }: Props) {
  const [inclusions, setInclusions] = useState<Inclusion[]>([]);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  useEffect(() => {
    if (!open || !item) { setInclusions([]); setBullets([]); return; }
    (async () => {
      if (item.item_type === "wedding_package") {
        const { data } = await supabase
          .from("package_default_inclusions")
          .select("quantity,service_items!package_default_inclusions_included_item_id_fkey(name)")
          .eq("package_item_id", item.id);
        setInclusions(((data ?? []) as any[]).map((r) => ({
          name: r.service_items?.name ?? "(item)",
          quantity: r.quantity ?? 1,
        })));
      } else {
        setInclusions([]);
      }
      const { data: bs } = await (supabase as any)
        .from("service_item_inclusions")
        .select("text,display_order")
        .eq("service_item_id", item.id)
        .order("display_order");
      setBullets(((bs ?? []) as any[]).map((r) => ({ text: r.text })));
    })();
  }, [open, item]);

  if (!open || !item) return null;
  const priceStr = item.price_cents != null
    ? `$${(item.price_cents / 100).toLocaleString()}`
    : "No price";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(65,25,40,0.45)" }}>
      <div className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-lg" style={{ background: "var(--sbv-pink-soft)" }}>
        <div className="flex items-center justify-between px-7 pt-6 pb-2">
          <h2 className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>{item.name}</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--sbv-purple)" }} className="opacity-70 hover:opacity-100">
            <X size={20} />
          </button>
        </div>
        <div className="px-7 py-5 space-y-4 text-sm" style={{ color: "var(--sbv-purple)" }}>
          {item.description && <p className="leading-relaxed">{item.description}</p>}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <dt className="font-serif" style={{ color: "var(--sbv-green)" }}>Type</dt>
            <dd>{ITEM_TYPE_LABELS[item.item_type]}</dd>
            <dt className="font-serif" style={{ color: "var(--sbv-green)" }}>Price</dt>
            <dd>{priceStr} {item.unit !== "flat" && `· ${UNIT_LABELS[item.unit]}`}</dd>
            {item.coverage_hours != null && (
              <>
                <dt className="font-serif" style={{ color: "var(--sbv-green)" }}>Coverage</dt>
                <dd>{item.coverage_hours}h</dd>
              </>
            )}
            <dt className="font-serif" style={{ color: "var(--sbv-green)" }}>Status</dt>
            <dd>{item.is_active ? "Active" : "Inactive"}</dd>
          </dl>
          {item.item_type === "wedding_package" && (
            <div className="pt-3 border-t" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
              <h3 className="font-serif text-base mb-2" style={{ color: "var(--sbv-green)" }}>Default inclusions</h3>
              {inclusions.length === 0 ? (
                <p className="italic opacity-70">None.</p>
              ) : (
                <ul className="space-y-1">
                  {inclusions.map((i, idx) => (
                    <li key={idx}>· {i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="pt-3 border-t" style={{ borderColor: "rgba(65,25,40,0.18)" }}>
            <h3 className="font-serif text-base mb-2" style={{ color: "var(--sbv-green)" }}>What's included</h3>
            {bullets.length === 0 ? (
              <p className="italic opacity-70">No inclusions listed.</p>
            ) : (
              <ul className="space-y-1 list-disc pl-5">
                {bullets.map((b, idx) => (
                  <li key={idx}>{b.text}</li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs italic opacity-70 pt-2">Read-only — only owners can edit service items.</p>

        </div>
        <div className="px-7 py-5 flex items-center justify-end">
          <button onClick={onClose} className="text-sm font-medium hover:underline" style={{ color: "var(--sbv-purple)" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
