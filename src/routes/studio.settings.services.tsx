import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, GripVertical } from "lucide-react";
import {
  DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { useIsOwner } from "@/lib/auth";
import {
  ServiceItemEditorModal,
  ITEM_TYPE_LABELS,
  UNIT_LABELS,
  type ServiceItemRow,
  type ServiceItemType,
} from "@/components/studio/ServiceItemEditorModal";
import { ServiceItemReadOnlyModal } from "@/components/studio/ServiceItemReadOnlyModal";

export const Route = createFileRoute("/studio/settings/services")({
  component: ServicesPage,
});

const SECTION_ORDER: { type: ServiceItemType; label: string }[] = [
  { type: "wedding_package", label: "Wedding Packages" },
  { type: "engagement_session", label: "Sessions" }, // engagement + portrait grouped below
  { type: "album", label: "Albums" },
  { type: "videography", label: "Videography" },
  { type: "print", label: "Prints" },
  { type: "add_on", label: "Add-ons" },
  { type: "travel", label: "Travel" },
  { type: "deliverable", label: "Deliverables" },
  { type: "custom", label: "Custom" },
];

function formatPrice(item: ServiceItemRow) {
  if (item.price_cents == null) return "No price";
  const dollars = (item.price_cents / 100).toLocaleString();
  if (item.unit === "flat") return `$${dollars}`;
  const suffix: Record<string, string> = {
    per_hour: "/hour", per_mile: "/mile", per_person: "/person", per_unit: "/unit",
  };
  return `$${dollars}${suffix[item.unit] ?? ""}`;
}

function ItemCard({
  item, marginCents, onClick, isOwner,
}: {
  item: ServiceItemRow; marginCents: number | null; onClick: () => void; isOwner: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : item.is_active ? 1 : 0.55,
    background: "var(--sbv-pink)",
  };
  const marginPct =
    marginCents != null && item.price_cents && item.price_cents > 0
      ? (marginCents / item.price_cents) * 100
      : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-sm px-4 py-3 flex items-center gap-3"
    >
      {isOwner && (
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="cursor-grab opacity-50 hover:opacity-90"
          style={{ color: "var(--sbv-purple)" }}
        >
          <GripVertical size={16} />
        </button>
      )}
      <button onClick={onClick} className="flex-1 text-left">
        <div className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>{item.name}</div>
        <div className="text-xs mt-0.5 flex flex-wrap gap-x-3" style={{ color: "var(--sbv-purple)" }}>
          <span>{formatPrice(item)}</span>
          {isOwner && marginPct != null && (
            <span
              style={{
                color: marginPct >= 0 ? "var(--sbv-green)" : "var(--sbv-fuchsia)",
              }}
            >
              {marginPct.toFixed(0)}% margin
            </span>
          )}
          {!item.is_active && <span className="italic">inactive</span>}
        </div>
      </button>
    </div>
  );
}

function ServicesPage() {
  const isOwner = useIsOwner();
  const [items, setItems] = useState<ServiceItemRow[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({}); // service_item_id -> cost_cents
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServiceItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<ServiceItemRow | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("service_items")
      .select("id,name,description,item_type,price_cents,unit,coverage_hours,is_active,display_order,is_taxable")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("name");
    setItems((data ?? []) as ServiceItemRow[]);

    if (isOwner) {
      const { data: cdata } = await supabase
        .from("service_item_costs")
        .select("service_item_id,cost_cents");
      const map: Record<string, number> = {};
      ((cdata ?? []) as { service_item_id: string; cost_cents: number }[]).forEach((r) => {
        map[r.service_item_id] = r.cost_cents;
      });
      setCosts(map);
    } else {
      setCosts({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [isOwner]);

  const sections = useMemo(() => {
    return SECTION_ORDER.map((s) => {
      const types: ServiceItemType[] =
        s.type === "engagement_session" ? ["engagement_session", "portrait_session"] : [s.type];
      const list = items.filter((i) => types.includes(i.item_type));
      return { ...s, list };
    });
  }, [items]);

  const handleDragEnd = async (e: DragEndEvent, sectionItems: ServiceItemRow[]) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionItems.findIndex((i) => i.id === active.id);
    const newIdx = sectionItems.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sectionItems, oldIdx, newIdx);
    // Optimistic local update
    const next = items.map((it) => {
      const idx = reordered.findIndex((r) => r.id === it.id);
      if (idx === -1) return it;
      return { ...it, display_order: idx };
    });
    setItems(next);
    // Persist display_order for affected rows
    await Promise.all(
      reordered.map((r, idx) =>
        supabase.from("service_items").update({ display_order: idx }).eq("id", r.id),
      ),
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl" style={{ color: "var(--sbv-green)" }}>Services</h1>
        {isOwner && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-medium text-white"
            style={{ background: "var(--sbv-green)" }}
          >
            <Plus size={16} /> New service item
          </button>
        )}
      </div>

      {!isOwner && (
        <p className="text-xs mb-4 italic" style={{ color: "var(--sbv-purple)" }}>
          Read-only — only owners can create or edit service items.
        </p>
      )}

      {loading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : items.length === 0 && !isOwner ? (
        <p className="text-sm opacity-70">No service items yet.</p>
      ) : (
        <div className="space-y-8">
          {sections.map((s) => {
            if (s.list.length === 0 && !isOwner) return null;
            return (
              <section key={s.type}>
                <h2 className="font-serif text-xl mb-3" style={{ color: "var(--sbv-green)" }}>{s.label}</h2>
                {s.list.length === 0 ? (
                  <p className="text-xs italic opacity-70" style={{ color: "var(--sbv-purple)" }}>
                    No items yet — use “New service item” to add one.
                  </p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => isOwner && handleDragEnd(e, s.list)}
                  >
                    <SortableContext items={s.list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {s.list.map((item) => {
                          const cost = costs[item.id];
                          const marginCents =
                            isOwner && cost != null && item.price_cents != null
                              ? item.price_cents - cost
                              : null;
                          return (
                            <ItemCard
                              key={item.id}
                              item={item}
                              marginCents={marginCents}
                              isOwner={isOwner}
                              onClick={() => (isOwner ? setEditing(item) : setViewing(item))}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ServiceItemEditorModal
        open={creating || editing != null}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={load}
        item={editing}
        allItems={items}
      />
      <ServiceItemReadOnlyModal
        open={viewing != null}
        onClose={() => setViewing(null)}
        item={viewing}
      />

      <div className="mt-10 text-xs italic opacity-60" style={{ color: "var(--sbv-purple)" }}>
        Used by quotes &amp; bookings. Prices visible to studio; costs &amp; margin owner-only.
      </div>
    </div>
  );
}

// Avoid unused-export warnings in dev fast refresh
export const __keep = { ITEM_TYPE_LABELS, UNIT_LABELS };
