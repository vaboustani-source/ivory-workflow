import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, Pencil, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsOwner } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import type { Database } from "@/integrations/supabase/types";
import { shortDate } from "@/lib/dates";

type QuoteInclusion = { id: string; quote_item_id: string; text: string; display_order: number };

type ItemType = Database["public"]["Enums"]["service_item_type"];
type QuoteStatus = Database["public"]["Enums"]["quote_status"];

type Quote = {
  id: string;
  client_id: string;
  status: QuoteStatus;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  valid_until: string | null;
  notes: string | null;
};

type QuoteItem = {
  id: string;
  quote_id: string;
  service_item_id: string | null;
  description_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  item_type_snapshot: ItemType | null;
  display_order: number;
};

type ServiceItem = {
  id: string;
  name: string;
  item_type: ItemType;
  price_cents: number;
  unit: string;
  is_active: boolean;
};

type Invoice = {
  id: string;
  label: string | null;
  due_date: string | null;
  total_cents: number | null;
  status: Database["public"]["Enums"]["invoice_status"];
  sequence_order: number | null;
};

const TYPE_LABEL: Record<string, string> = {
  wedding_package: "Wedding Packages",
  engagement_session: "Sessions",
  portrait_session: "Sessions",
  album: "Albums",
  videography: "Videography",
  print: "Prints",
  add_on: "Add-ons",
  travel: "Travel",
  deliverable: "Deliverables",
  custom: "Custom",
};

const fmtMoney = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function StatusPill({ status }: { status: QuoteStatus }) {
  const map: Record<QuoteStatus, { label: string; style: React.CSSProperties; cls?: string }> = {
    draft: { label: "Draft", style: { background: "#E5E0D8", color: "var(--sbv-purple)" } },
    sent: { label: "Sent", style: {}, cls: "foil-gold" },
    accepted: { label: "Accepted", style: { background: "var(--sbv-green)", color: "white" } },
    expired: { label: "Expired", style: { background: "var(--sbv-purple)", color: "white" } },
  };
  const s = map[status];
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${s.cls ?? ""}`}
      style={s.style}
    >
      {s.label}
    </span>
  );
}

export function QuoteTab({ clientId }: { clientId: string }) {
  const isOwner = useIsOwner();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [catalog, setCatalog] = useState<ServiceItem[]>([]);
  const [inclusions, setInclusions] = useState<Record<string, QuoteInclusion[]>>({});
  const [editingInclusionsFor, setEditingInclusionsFor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInclusions = async (itemIds: string[]) => {
    if (itemIds.length === 0) { setInclusions({}); return; }
    const { data } = await (supabase as any)
      .from("quote_item_inclusions")
      .select("id,quote_item_id,text,display_order")
      .in("quote_item_id", itemIds)
      .order("display_order");
    const map: Record<string, QuoteInclusion[]> = {};
    for (const row of ((data ?? []) as QuoteInclusion[])) {
      (map[row.quote_item_id] ||= []).push(row);
    }
    setInclusions(map);
  };

  const load = async () => {
    setLoading(true);
    const [{ data: q }, { data: invs }] = await Promise.all([
      supabase
        .from("quotes")
        .select("id,client_id,status,subtotal_cents,discount_cents,total_cents,valid_until,notes")
        .eq("client_id", clientId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("id,label,due_date,total_cents,status,sequence_order")
        .eq("client_id", clientId)
        .order("sequence_order"),
    ]);
    const quoteRow = (q ?? null) as Quote | null;
    setQuote(quoteRow);
    if (quoteRow) {
      const { data: li } = await supabase
        .from("quote_items")
        .select("id,quote_id,service_item_id,description_snapshot,unit_price_cents,quantity,line_total_cents,item_type_snapshot,display_order")
        .eq("quote_id", quoteRow.id)
        .order("display_order")
        .order("created_at");
      const rows = (li ?? []) as QuoteItem[];
      setItems(rows);
      setDiscountInput(quoteRow.discount_cents ? String(quoteRow.discount_cents / 100) : "");
      setNotesInput(quoteRow.notes ?? "");
      await loadInclusions(rows.map((r) => r.id));
    } else {
      setItems([]);
      setInclusions({});
      setDiscountInput("");
      setNotesInput("");
    }
    setInvoices((invs ?? []) as Invoice[]);
    const { data: si } = await supabase
      .from("service_items")
      .select("id,name,item_type,price_cents,unit,is_active")
      .eq("is_active", true)
      .order("display_order")
      .order("name");
    setCatalog((si ?? []) as ServiceItem[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.line_total_cents, 0), [items]);
  const discountCents = Math.max(0, Math.round((Number(discountInput) || 0) * 100));
  const total = Math.max(0, subtotal - discountCents);

  const cancelledStatuses = new Set(["cancelled", "refunded", "kill_fee"]);
  const scheduledTotal = useMemo(
    () => invoices.filter((i) => !cancelledStatuses.has(i.status)).reduce((s, i) => s + (i.total_cents ?? 0), 0),
    [invoices],
  );
  const paidTotal = useMemo(
    () => invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.total_cents ?? 0), 0),
    [invoices],
  );
  const remainingTotal = scheduledTotal - paidTotal;

  // Persist quote header (subtotal/discount/total/notes) — debounced
  useEffect(() => {
    if (!quote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("quotes")
        .update({
          subtotal_cents: subtotal,
          discount_cents: discountCents,
          total_cents: total,
          notes: notesInput || null,
        })
        .eq("id", quote.id);
      if (error) toast.error(error.message);
      else {
        setQuote((prev) =>
          prev ? { ...prev, subtotal_cents: subtotal, discount_cents: discountCents, total_cents: total, notes: notesInput || null } : prev,
        );
      }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, discountCents, total, notesInput, quote?.id]);

  const buildQuote = async () => {
    const { data, error } = await supabase
      .from("quotes")
      .insert({ client_id: clientId, status: "draft" })
      .select("id,client_id,status,subtotal_cents,discount_cents,total_cents,valid_until,notes")
      .single();
    if (error) { toast.error(error.message); return; }
    setQuote(data as Quote);
    setItems([]);
    await logActivity({
      client_id: clientId,
      action_type: "quote.created",
      description: "Created draft quote",
      target_type: "quote",
      target_id: data.id,
    });
  };

  const addItem = async (serviceItemId: string | null, customDesc?: string, customPriceCents?: number, parentName?: string) => {
    if (!quote) return null;
    const displayOrder = items.length;
    const { data, error } = await supabase.rpc("add_quote_item", {
      p_quote_id: quote.id,
      p_service_item_id: serviceItemId as unknown as string,
      p_quantity: 1,
      p_custom_description: customDesc ?? undefined,
      p_custom_price_cents: customPriceCents ?? undefined,
      p_display_order: displayOrder,
    });
    if (error) { toast.error(error.message); return null; }
    const payload = data as unknown as { quote_item_id: string | null; proposed?: boolean; pending_change_id?: string; message?: string };
    if (payload?.proposed) {
      toast.success(payload.message ?? "Change proposed — awaiting owner approval.");
      return null;
    }
    const newId = payload?.quote_item_id ?? null;
    if (newId) {
      await logActivity({
        client_id: clientId,
        action_type: "quote.item_added",
        description: parentName
          ? `Added "${customDesc ?? ""}" (included with ${parentName})`
          : `Added "${customDesc ?? catalog.find((c) => c.id === serviceItemId)?.name ?? "custom line"}"`,
        target_type: "quote_item",
        target_id: newId,
      });
    }
    return newId;
  };

  const handleAddCatalog = async (si: ServiceItem) => {
    setPickerOpen(false);
    setPickerQuery("");
    await addItem(si.id);
    // If wedding package, auto-add inclusions
    if (si.item_type === "wedding_package") {
      const { data: incs } = await supabase
        .from("package_default_inclusions")
        .select("included_item_id, quantity")
        .eq("package_item_id", si.id);
      for (const inc of (incs ?? []) as { included_item_id: string; quantity: number }[]) {
        const child = catalog.find((c) => c.id === inc.included_item_id);
        if (child) {
          await addItem(child.id, `${child.name} — included with ${si.name}`, undefined, si.name);
        }
      }
    }
    await load();
  };

  const handleAddCustom = async () => {
    setPickerOpen(false);
    setPickerQuery("");
    await addItem(null, "New custom line", 0);
    await load();
  };

  const updateItem = async (id: string, patch: Partial<Pick<QuoteItem, "description_snapshot" | "unit_price_cents" | "quantity">>) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    const line_total_cents = Math.round(next.unit_price_cents * next.quantity);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...next, line_total_cents } : i)));
    const { error } = await supabase
      .from("quote_items")
      .update({ ...patch, line_total_cents })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const removeItem = async (id: string) => {
    const item = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    const { error } = await supabase.from("quote_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await logActivity({
      client_id: clientId,
      action_type: "quote.item_removed",
      description: `Removed "${item?.description_snapshot ?? ""}"`,
      target_type: "quote_item",
      target_id: id,
    });
  };

  // Per-line inclusion edits (writes to quote_item_inclusions only — never the catalog)
  const addInclusion = async (quoteItemId: string) => {
    const list = inclusions[quoteItemId] ?? [];
    const display_order = list.length;
    const { data, error } = await (supabase as any)
      .from("quote_item_inclusions")
      .insert({ quote_item_id: quoteItemId, text: "", display_order })
      .select("id,quote_item_id,text,display_order")
      .single();
    if (error) { toast.error(error.message); return; }
    setInclusions((m) => ({ ...m, [quoteItemId]: [...list, data as QuoteInclusion] }));
  };

  const updateInclusion = async (quoteItemId: string, id: string, text: string) => {
    setInclusions((m) => ({
      ...m,
      [quoteItemId]: (m[quoteItemId] ?? []).map((b) => (b.id === id ? { ...b, text } : b)),
    }));
    const { error } = await (supabase as any)
      .from("quote_item_inclusions")
      .update({ text })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const removeInclusion = async (quoteItemId: string, id: string) => {
    setInclusions((m) => ({
      ...m,
      [quoteItemId]: (m[quoteItemId] ?? []).filter((b) => b.id !== id),
    }));
    const { error } = await (supabase as any)
      .from("quote_item_inclusions")
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const moveInclusion = async (quoteItemId: string, id: string, dir: -1 | 1) => {
    const list = [...(inclusions[quoteItemId] ?? [])];
    const idx = list.findIndex((b) => b.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    const updated = list.map((b, i) => ({ ...b, display_order: i }));
    setInclusions((m) => ({ ...m, [quoteItemId]: updated }));
    // Persist new orders for the two affected rows
    await Promise.all(
      updated.map((b) =>
        (supabase as any).from("quote_item_inclusions").update({ display_order: b.display_order }).eq("id", b.id),
      ),
    );
  };



  // Picker filtering
  const filteredCatalog = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const rows = q
      ? catalog.filter((c) => c.name.toLowerCase().includes(q))
      : catalog;
    const groups: Record<string, ServiceItem[]> = {};
    for (const r of rows) {
      const key = r.item_type;
      (groups[key] ||= []).push(r);
    }
    return groups;
  }, [catalog, pickerQuery]);

  if (loading) {
    return <p className="text-sm opacity-70">Loading quote…</p>;
  }

  if (!quote) {
    return (
      <div className="space-y-5">
        <h2 className="font-serif italic text-[28px]" style={{ color: "var(--sbv-green)" }}>Quote</h2>
        <div
          className="rounded-sm p-10 text-center"
          style={{ background: "#F0A5BE" }}
        >
          <p className="font-serif text-xl mb-4" style={{ color: "var(--sbv-green)" }}>No quote yet.</p>
          <button
            onClick={buildQuote}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-sm text-sm font-medium text-white"
            style={{ background: "var(--sbv-green)" }}
          >
            <Plus size={16} /> Build quote
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-serif italic text-[28px]" style={{ color: "var(--sbv-green)" }}>Quote</h2>
          <StatusPill status={quote.status} />
        </div>
        {quote.status === "sent" && quote.valid_until && (
          <p className="text-xs" style={{ color: "var(--sbv-purple)" }}>
            Valid until {new Date(quote.valid_until).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Line items */}
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm italic opacity-70" style={{ color: "var(--sbv-purple)" }}>
            No line items yet — use "Add item" below.
          </p>
        )}
        {items.map((it) => {
          const isPerUnit = it.item_type_snapshot &&
            ["engagement_session", "portrait_session", "wedding_package", "album", "videography", "print", "add_on", "deliverable", "custom"].includes(it.item_type_snapshot);
          return (
            <div
              key={it.id}
              className="rounded-sm px-4 py-3"
              style={{ background: "#F0A5BE" }}
            >
              <div className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-5">
                  <input
                    type="text"
                    value={it.description_snapshot}
                    onChange={(e) => updateItem(it.id, { description_snapshot: e.target.value })}
                    className="w-full bg-transparent font-serif text-base outline-none"
                    style={{ color: "var(--sbv-green)" }}
                  />
                  {it.item_type_snapshot && (
                    <div className="text-[10px] uppercase tracking-wider mt-0.5 opacity-60" style={{ color: "var(--sbv-purple)" }}>
                      {TYPE_LABEL[it.item_type_snapshot] ?? it.item_type_snapshot}
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase tracking-wider opacity-60" style={{ color: "var(--sbv-purple)" }}>Unit price</label>
                  <div className="flex items-center gap-1">
                    <span style={{ color: "var(--sbv-purple)" }}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={(it.unit_price_cents / 100).toString()}
                      onChange={(e) => updateItem(it.id, { unit_price_cents: Math.round((Number(e.target.value) || 0) * 100) })}
                      className="w-full bg-white/70 rounded-sm px-2 py-1 text-sm outline-none"
                      style={{ color: "var(--sbv-purple)" }}
                    />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase tracking-wider opacity-60" style={{ color: "var(--sbv-purple)" }}>Qty</label>
                  <input
                    type="number"
                    step={isPerUnit ? "0.5" : "1"}
                    min="0"
                    value={it.quantity}
                    onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) || 0 })}
                    className="w-full bg-white/70 rounded-sm px-2 py-1 text-sm outline-none"
                    style={{ color: "var(--sbv-purple)" }}
                  />
                </div>
                <div className="col-span-2 text-right font-serif" style={{ color: "var(--sbv-green)" }}>
                  {fmtMoney(it.line_total_cents)}
                </div>
                <div className="col-span-1 text-right">
                  <button
                    onClick={() => removeItem(it.id)}
                    aria-label="Remove"
                    className="p-1 opacity-60 hover:opacity-100"
                    style={{ color: "var(--sbv-purple)" }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Inclusion bullets */}
              {(() => {
                const list = inclusions[it.id] ?? [];
                const editing = editingInclusionsFor === it.id;
                if (list.length === 0 && !editing) {
                  return (
                    <div className="pl-1 mt-2">
                      <button
                        onClick={() => setEditingInclusionsFor(it.id)}
                        className="text-[11px] underline opacity-70 hover:opacity-100"
                        style={{ color: "var(--sbv-purple)" }}
                      >
                        + Add inclusions
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="mt-2 pl-5">
                    {!editing && (
                      <>
                        <ul className="space-y-0.5 list-disc pl-4" style={{ color: "#6B6B6B" }}>
                          {list.map((b) => (
                            <li key={b.id} className="text-[12px] font-sans">{b.text}</li>
                          ))}
                        </ul>
                        <button
                          onClick={() => setEditingInclusionsFor(it.id)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] underline opacity-70 hover:opacity-100"
                          style={{ color: "var(--sbv-purple)" }}
                        >
                          <Pencil size={11} /> Edit inclusions
                        </button>
                      </>
                    )}
                    {editing && (
                      <div className="space-y-1.5">
                        {list.map((b, idx) => (
                          <div key={b.id} className="flex items-center gap-1.5">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveInclusion(it.id, b.id, -1)}
                                className="text-[10px] leading-none opacity-60 hover:opacity-100 disabled:opacity-20"
                                style={{ color: "var(--sbv-purple)" }}
                                aria-label="Move up"
                              >▲</button>
                              <button
                                type="button"
                                disabled={idx === list.length - 1}
                                onClick={() => moveInclusion(it.id, b.id, 1)}
                                className="text-[10px] leading-none opacity-60 hover:opacity-100 disabled:opacity-20"
                                style={{ color: "var(--sbv-purple)" }}
                                aria-label="Move down"
                              >▼</button>
                            </div>
                            <input
                              type="text"
                              value={b.text}
                              onChange={(e) => updateInclusion(it.id, b.id, e.target.value)}
                              placeholder="e.g. 8 hours of coverage"
                              className="flex-1 bg-white/85 rounded-sm px-2 py-1 text-[12px] outline-none"
                              style={{ color: "var(--sbv-purple)" }}
                            />
                            <button
                              type="button"
                              onClick={() => removeInclusion(it.id, b.id)}
                              aria-label="Remove bullet"
                              className="p-1 opacity-60 hover:opacity-100"
                              style={{ color: "var(--sbv-purple)" }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => addInclusion(it.id)}
                            className="inline-flex items-center gap-1 text-[11px] underline opacity-80 hover:opacity-100"
                            style={{ color: "var(--sbv-purple)" }}
                          >
                            <Plus size={11} /> Add bullet
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingInclusionsFor(null)}
                            className="inline-flex items-center gap-1 text-[11px] underline opacity-80 hover:opacity-100"
                            style={{ color: "var(--sbv-green)" }}
                          >
                            <Check size={11} /> Done
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Add item button + picker */}
      <div className="relative">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-medium text-white"
          style={{ background: "var(--sbv-green)" }}
        >
          <Plus size={16} /> Add item
        </button>
        {pickerOpen && (
          <div
            className="absolute z-10 mt-2 w-[480px] max-h-[420px] overflow-auto rounded-sm shadow-lg border bg-white"
            style={{ borderColor: "var(--sbv-purple)" }}
          >
            <div className="p-3 flex items-center gap-2 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
              <input
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search service items…"
                className="flex-1 px-2 py-1 outline-none text-sm"
                style={{ color: "var(--sbv-purple)" }}
              />
              <button onClick={() => { setPickerOpen(false); setPickerQuery(""); }} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="py-1">
              <button
                onClick={handleAddCustom}
                className="w-full text-left px-4 py-2 text-sm hover:bg-pink-50"
                style={{ color: "var(--sbv-green)" }}
              >
                + Custom line
              </button>
              {Object.entries(filteredCatalog).map(([type, list]) => (
                <div key={type}>
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider opacity-60" style={{ color: "var(--sbv-purple)" }}>
                    {TYPE_LABEL[type] ?? type}
                  </div>
                  {list.map((si) => (
                    <button
                      key={si.id}
                      onClick={() => handleAddCatalog(si)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-pink-50 flex justify-between"
                      style={{ color: "var(--sbv-green)" }}
                    >
                      <span>{si.name}</span>
                      <span className="opacity-70">{fmtMoney(si.price_cents)}</span>
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(filteredCatalog).length === 0 && (
                <p className="px-4 py-3 text-xs italic opacity-60">No matching items.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Totals */}
      <div
        className="rounded-sm p-5 space-y-3"
        style={{ background: "#F0A5BE" }}
      >
        <div className="flex justify-between text-sm" style={{ color: "var(--sbv-purple)" }}>
          <span>Subtotal</span>
          <span>{fmtMoney(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm" style={{ color: "var(--sbv-purple)" }}>
          <span>Discount</span>
          <div className="flex items-center gap-1">
            <span>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-28 bg-white/70 rounded-sm px-2 py-1 text-right outline-none"
              style={{ color: "var(--sbv-purple)" }}
            />
          </div>
        </div>
        <div className="flex justify-between items-baseline pt-2 border-t" style={{ borderColor: "rgba(65,25,40,0.2)" }}>
          <span className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Total</span>
          <span className="font-serif text-3xl" style={{ color: "var(--sbv-green)" }}>{fmtMoney(total)}</span>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--sbv-purple)" }}>Notes</label>
        <textarea
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          rows={3}
          className="w-full rounded-sm px-3 py-2 text-sm outline-none"
          style={{ background: "#F0A5BE", color: "var(--sbv-purple)" }}
          placeholder="Internal or client-facing notes for this quote…"
        />
      </div>

      {/* Payment schedule */}
      <div className="space-y-4 pt-4">
        <h3 className="font-serif italic text-[22px]" style={{ color: "var(--sbv-green)" }}>Payment schedule</h3>
        {invoices.length === 0 ? (
          <div
            className="rounded-sm p-8 text-center"
            style={{ background: "#F0A5BE" }}
          >
            <p className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>No payment schedule yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary strip */}
            <div
              className="rounded-sm px-5 py-4 flex items-center justify-between"
              style={{ background: "#F0A5BE" }}
            >
              <div className="text-center flex-1">
                <p className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: "var(--sbv-purple)" }}>Total scheduled</p>
                <p className="font-serif text-xl" style={{ color: "var(--sbv-green)" }}>{fmtMoney(scheduledTotal)}</p>
              </div>
              <div className="text-center flex-1 border-l" style={{ borderColor: "rgba(65,25,40,0.15)" }}>
                <p className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: "var(--sbv-purple)" }}>Total paid</p>
                <p className="font-serif text-xl" style={{ color: "var(--sbv-green)" }}>{fmtMoney(paidTotal)}</p>
              </div>
              <div className="text-center flex-1 border-l" style={{ borderColor: "rgba(65,25,40,0.15)" }}>
                <p className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: "var(--sbv-purple)" }}>Balance remaining</p>
                <p className="font-serif text-xl" style={{ color: "var(--sbv-green)" }}>{fmtMoney(remainingTotal)}</p>
              </div>
            </div>

            {/* Invoice rows */}
            <div className="space-y-2">
              {invoices.map((inv) => {
                const amount = inv.total_cents ?? 0;
                const isCancelled = cancelledStatuses.has(inv.status);
                const isOverdue = inv.status === "overdue";
                const statusConfig: Record<
                  Database["public"]["Enums"]["invoice_status"],
                  { dotColor: string; label: string; extraCls?: string }
                > = {
                  draft: { dotColor: "#7A6A6E", label: "Draft" },
                  scheduled: { dotColor: "#EBDBC8", label: "Scheduled" },
                  sent: { dotColor: "#C9A24A", label: "Sent" },
                  viewed: { dotColor: "#411928", label: "Viewed" },
                  paid: { dotColor: "#103200", label: "Paid" },
                  overdue: { dotColor: "#103200", label: "Overdue" },
                  reschedule_requested: { dotColor: "#B41E64", label: "Reschedule requested" },
                  cancelled: { dotColor: "#7A6A6E", label: "Cancelled" },
                  refunded: { dotColor: "#7A6A6E", label: "Refunded" },
                  kill_fee: { dotColor: "#7A6A6E", label: "Kill fee" },
                };
                const cfg = statusConfig[inv.status];
                return (
                  <div
                    key={inv.id}
                    className={`rounded-sm px-4 py-3 flex items-center justify-between ${isCancelled ? "opacity-50" : ""}`}
                    style={{ background: "#F0A5BE" }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: cfg.dotColor }}
                      />
                      <div>
                        <p className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>
                          {isCancelled ? <span className="line-through">{inv.label ?? "—"}</span> : (inv.label ?? "—")}
                        </p>
                        {inv.due_date && (
                          <p className="text-[11px] opacity-70" style={{ color: "var(--sbv-purple)" }}>
                            {new Date(inv.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: isOverdue ? "#103200" : "transparent",
                          color: isOverdue ? "#fff" : cfg.dotColor,
                        }}
                      >
                        {isOverdue ? "overdue" : cfg.label}
                      </span>
                      <span className="font-serif text-base" style={{ color: "var(--sbv-green)", minWidth: "80px", textAlign: "right" }}>
                        {fmtMoney(amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quote vs schedule consistency check */}
            {quote && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--sbv-purple)" }}>
                <span>Quote total: {fmtMoney(quote.total_cents)}</span>
                <span>·</span>
                <span>Scheduled in payments: {fmtMoney(scheduledTotal)}</span>
                {quote.total_cents === scheduledTotal ? (
                  <span className="ml-1" style={{ color: "#103200" }}>✓ matches</span>
                ) : (
                  <span className="ml-1 opacity-70">⚠ quote total and payment schedule differ</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!isOwner && (
        <p className="text-[11px] italic opacity-60" style={{ color: "var(--sbv-purple)" }}>
          Quote saved automatically.
        </p>
      )}
    </div>
  );
}
