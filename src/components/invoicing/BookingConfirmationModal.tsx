import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calculateSchedule, fmtCents, type FeeSettings, type InstallmentInput } from "@/lib/invoiceMath";

interface Props {
  open: boolean;
  clientId: string | null;
  coupleLabel: string;
  weddingDateISO: string | null;
  onClose: () => void;
  onConfirmed: () => void;
}

interface Bundle {
  packageName: string | null;
  basePriceCents: number;
  addProcessingFees: boolean;
  fees: FeeSettings | null;
  templateId: string | null;
  templateName: string | null;
  installments: InstallmentInput[];
  availableTemplates: { id: string; name: string }[];
  defaultTemplateId: string | null;
  hasPackage: boolean;
}

type Mode = "package" | "tbd";

export function BookingConfirmationModal({ open, clientId, coupleLabel, weddingDateISO, onClose, onConfirmed }: Props) {
  const [mode, setMode] = useState<Mode>("package");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { due_date?: string; label?: string }>>({});
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TBD state
  const [tbdDepositDollars, setTbdDepositDollars] = useState<string>("2000");
  const [tbdFinalizeBy, setTbdFinalizeBy] = useState<string>("");
  const [tbdFinalizeWindowDays, setTbdFinalizeWindowDays] = useState<number>(7);
  const [confirmedConflict, setConfirmedConflict] = useState<{ couple: string } | null>(null);
  const [tbdConflictCount, setTbdConflictCount] = useState<number>(0);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setOverrides({}); setOverrideOpen(false);
      try {
        const [{ data: client }, { data: settings }, { data: feesRows }, { data: templates }] = await Promise.all([
          supabase.from("clients").select("package_id, package_price").eq("id", clientId).single(),
          supabase.from("studio_invoicing_settings").select("tbd_deposit_amount_cents, tbd_finalize_window_days").limit(1),
          supabase.from("processing_fee_settings").select("stripe_percentage, stripe_flat_cents").limit(1),
          supabase.from("payment_schedule_templates").select("id, name").eq("is_active", true),
        ]);

        const fees = feesRows?.[0] ? { stripe_percentage: Number(feesRows[0].stripe_percentage), stripe_flat_cents: Number(feesRows[0].stripe_flat_cents) } : null;

        let pkg: any = null;
        let basePriceCents = 0;
        let installments: InstallmentInput[] = [];
        let templateName: string | null = null;
        let tplId: string | null = null;
        const hasPackage = !!client?.package_id;

        if (hasPackage) {
          const { data: pkgRow } = await supabase.from("packages")
            .select("id, name, base_price, add_processing_fees, default_payment_schedule_template_id")
            .eq("id", client!.package_id!).single();
          pkg = pkgRow;
          if (pkg) {
            const basePrice = Number(client?.package_price ?? pkg.base_price ?? 0);
            basePriceCents = Math.round(basePrice * 100);
            tplId = pkg.default_payment_schedule_template_id ?? null;
            if (tplId) {
              const { data: insts } = await supabase
                .from("payment_schedule_template_installments")
                .select("sequence_order, label, percentage, due_offset_type, due_offset_days")
                .eq("template_id", tplId).order("sequence_order");
              installments = (insts ?? []).map((i: any) => ({
                sequence_order: i.sequence_order, label: i.label,
                percentage: Number(i.percentage),
                due_offset_type: i.due_offset_type, due_offset_days: i.due_offset_days,
              }));
              templateName = (templates ?? []).find((t: any) => t.id === tplId)?.name ?? null;
            }
          }
        }

        // TBD settings
        const depositCents = settings?.[0]?.tbd_deposit_amount_cents ?? 200000;
        const winDays = settings?.[0]?.tbd_finalize_window_days ?? 7;
        const finalizeByDate = new Date();
        finalizeByDate.setDate(finalizeByDate.getDate() + winDays);
        const finalizeByISO = finalizeByDate.toISOString().slice(0, 10);

        // Conflict check (other confirmed bookings on same date)
        let conflict: { couple: string } | null = null;
        let tbdOthers = 0;
        if (weddingDateISO) {
          const { data: conflicts } = await supabase
            .from("clients")
            .select("id, couple_name_1, couple_name_2, is_tbd_booking, status")
            .eq("wedding_date", weddingDateISO)
            .eq("status", "booked")
            .neq("id", clientId);
          (conflicts ?? []).forEach((c: any) => {
            if (!c.is_tbd_booking && !conflict) {
              conflict = { couple: `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}` };
            } else if (c.is_tbd_booking) {
              tbdOthers += 1;
            }
          });
        }

        if (cancelled) return;
        const defaultMode: Mode = (hasPackage && tplId) ? "package" : "tbd";
        setMode(defaultMode);
        setTbdDepositDollars(String((depositCents / 100).toFixed(0)));
        setTbdFinalizeWindowDays(winDays);
        setTbdFinalizeBy(finalizeByISO);
        setConfirmedConflict(conflict);
        setTbdConflictCount(tbdOthers);
        setBundle({
          packageName: pkg?.name ?? null,
          basePriceCents,
          addProcessingFees: !!pkg?.add_processing_fees,
          fees,
          templateId: tplId,
          templateName,
          installments,
          availableTemplates: (templates ?? []).map((t: any) => ({ id: t.id, name: t.name })),
          defaultTemplateId: tplId,
          hasPackage,
        });
        setSelectedTemplateId(tplId);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, clientId, weddingDateISO]);

  // Refetch installments if user picks a different template (Option A only)
  useEffect(() => {
    if (!bundle || !selectedTemplateId || selectedTemplateId === bundle.templateId) return;
    (async () => {
      const { data: insts } = await supabase
        .from("payment_schedule_template_installments")
        .select("sequence_order, label, percentage, due_offset_type, due_offset_days")
        .eq("template_id", selectedTemplateId).order("sequence_order");
      const tplName = bundle.availableTemplates.find((t) => t.id === selectedTemplateId)?.name ?? null;
      setBundle({
        ...bundle,
        templateId: selectedTemplateId,
        templateName: tplName,
        installments: (insts ?? []).map((i: any) => ({
          sequence_order: i.sequence_order, label: i.label,
          percentage: Number(i.percentage),
          due_offset_type: i.due_offset_type, due_offset_days: i.due_offset_days,
        })),
      });
      setOverrides({});
    })();
  }, [selectedTemplateId, bundle]);

  const calculated = useMemo(() => {
    if (!bundle || bundle.installments.length === 0) return null;
    try {
      return calculateSchedule({
        basePriceCents: bundle.basePriceCents,
        addProcessingFees: bundle.addProcessingFees,
        fees: bundle.fees,
        installments: bundle.installments,
        weddingDateISO,
        overrides: Object.entries(overrides).map(([k, v]) => ({ installment_index: Number(k), ...v })),
      });
    } catch (e: any) {
      return { error: e.message } as any;
    }
  }, [bundle, overrides, weddingDateISO]);

  if (!open) return null;

  const calcArr = Array.isArray(calculated) ? calculated : null;
  const calcError = calculated && !Array.isArray(calculated) ? (calculated as any).error : null;
  const studioReceives = calcArr?.reduce((s, r) => s + r.subtotal_cents, 0) ?? 0;
  const clientPays = calcArr?.reduce((s, r) => s + r.total_cents, 0) ?? 0;

  const depositCents = Math.round((parseFloat(tbdDepositDollars) || 0) * 100);

  const handleConfirmPackage = async () => {
    if (!clientId || !bundle?.templateId) return;
    setSubmitting(true);
    const payload = Object.entries(overrides).map(([k, v]) => ({ installment_index: Number(k), ...v }));
    const { data, error: rpcErr } = await supabase.rpc("create_booking_invoices", {
      p_client_id: clientId, p_template_id: bundle.templateId, p_overrides: payload,
    });
    setSubmitting(false);
    if (rpcErr) { toast.error(`Couldn't create invoices: ${rpcErr.message}`); return; }
    const ids = (data as any)?.invoice_ids ?? [];
    toast.success(`Booking confirmed. ${ids.length} invoice${ids.length === 1 ? "" : "s"} created.`);
    onConfirmed(); onClose();
  };

  const handleConfirmTbd = async () => {
    if (!clientId) return;
    if (!weddingDateISO) { toast.error("Set a wedding date before creating a date hold."); return; }
    if (depositCents <= 0) { toast.error("Deposit amount must be greater than zero."); return; }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc("create_tbd_booking", {
      p_client_id: clientId, p_deposit_amount_cents: depositCents,
    });
    setSubmitting(false);
    if (rpcErr) { toast.error(`Couldn't create date hold: ${rpcErr.message}`); return; }
    toast.success(`Date hold created. ${fmtCents(depositCents)} deposit invoice scheduled.`);
    onConfirmed(); onClose();
  };

  const noTemplate = !loading && bundle && mode === "package" && !bundle.templateId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,15,0.45)" }} onClick={onClose}>
      <div
        className="w-full max-w-[760px] max-h-[90vh] overflow-y-auto rounded-md shadow-xl"
        style={{ background: "var(--sbv-pink, #F0A5BE)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-7 pt-6">
          <div>
            <h2 className="font-serif text-3xl" style={{ color: "var(--sbv-green)" }}>Confirm booking</h2>
            <p className="text-sm mt-1" style={{ color: "var(--sbv-purple)" }}>
              {coupleLabel}{weddingDateISO ? ` — ${new Date(weddingDateISO + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}` : " — wedding date TBD"}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5" style={{ color: "var(--sbv-purple)" }}><X size={18} /></button>
        </div>

        <div className="px-7 py-5 space-y-6">
          {loading && <p className="text-sm italic" style={{ color: "var(--sbv-purple)" }}>Loading…</p>}
          {error && <p className="text-sm" style={{ color: "#7a1c1c" }}>{error}</p>}

          {bundle && !loading && (
            <>
              {/* FORK */}
              <section>
                <h3 className="font-serif text-xl mb-3" style={{ color: "var(--sbv-green)" }}>How is this booking moving forward?</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ModeCard
                    selected={mode === "package"}
                    onClick={() => setMode("package")}
                    title="Package finalized"
                    subtitle="Generate the full payment schedule now."
                    disabled={!bundle.hasPackage}
                  />
                  <ModeCard
                    selected={mode === "tbd"}
                    onClick={() => setMode("tbd")}
                    title="Date-hold booking"
                    subtitle="Lock the date with a deposit. Finalize package within 7 days."
                  />
                </div>
                {!bundle.hasPackage && mode === "package" && (
                  <p className="text-xs italic mt-2" style={{ color: "var(--sbv-purple)" }}>
                    No package selected on this client — only date-hold is available.
                  </p>
                )}
              </section>

              {/* OPTION A — Existing flow */}
              {mode === "package" && (
                <>
                  {bundle.hasPackage && (
                    <section>
                      <h3 className="font-serif text-xl mb-1" style={{ color: "var(--sbv-green)" }}>Package</h3>
                      <p className="font-serif text-lg" style={{ color: "var(--sbv-purple)" }}>{bundle.packageName}</p>
                      <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                        {fmtCents(bundle.basePriceCents)} base ·{" "}
                        <span className="italic">{bundle.addProcessingFees ? "Fees baked in" : "Studio absorbs fees"}</span>
                      </p>
                    </section>
                  )}

                  {noTemplate && (
                    <section className="rounded-sm p-4" style={{ background: "rgba(255,255,255,0.4)", border: "1px solid rgba(65,25,40,0.18)" }}>
                      <p className="text-sm mb-2" style={{ color: "var(--sbv-purple)" }}>
                        This package has no default payment schedule. Select one to continue.
                      </p>
                      <select
                        value={selectedTemplateId ?? ""}
                        onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                        className="w-full rounded-sm px-3 py-2 text-sm"
                        style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }}
                      >
                        <option value="">— Choose a template —</option>
                        {bundle.availableTemplates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                      </select>
                    </section>
                  )}

                  {calcError && <p className="text-sm" style={{ color: "#7a1c1c" }}>{calcError}</p>}

                  {calcArr && (
                    <ScheduleTable bundle={bundle} calcArr={calcArr} studioReceives={studioReceives} clientPays={clientPays} />
                  )}

                  {calcArr && (
                    <section>
                      <button
                        type="button"
                        onClick={() => setOverrideOpen(!overrideOpen)}
                        className="flex items-center gap-2 text-sm font-medium"
                        style={{ color: "var(--sbv-purple)" }}
                      >
                        {overrideOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Override schedule before sending
                      </button>
                      {overrideOpen && (
                        <div className="mt-3 space-y-2">
                          {calcArr.map((r) => (
                            <div key={r.index} className="grid grid-cols-[1fr_1fr] gap-2 items-center">
                              <input type="text" value={overrides[r.index]?.label ?? r.label}
                                onChange={(e) => setOverrides({ ...overrides, [r.index]: { ...overrides[r.index], label: e.target.value } })}
                                className="rounded-sm px-2 py-1.5 text-sm"
                                style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }} />
                              <input type="date" value={overrides[r.index]?.due_date ?? r.due_date}
                                onChange={(e) => setOverrides({ ...overrides, [r.index]: { ...overrides[r.index], due_date: e.target.value } })}
                                className="rounded-sm px-2 py-1.5 text-sm"
                                style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}

              {/* OPTION B — TBD */}
              {mode === "tbd" && (
                <>
                  <section>
                    <h3 className="font-serif text-xl mb-2" style={{ color: "var(--sbv-green)" }}>Date hold details</h3>
                    {!weddingDateISO ? (
                      <p className="text-sm" style={{ color: "#7a1c1c" }}>Set a wedding date before creating a date hold.</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                          Wedding date: <span className="font-medium">{new Date(weddingDateISO + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>
                        </p>
                        <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                          Finalize by: <span className="font-medium">{new Date(tbdFinalizeBy + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>
                          <span className="ml-2 opacity-70">({tbdFinalizeWindowDays} days)</span>
                        </p>
                        <div>
                          <label className="block text-sm font-medium mb-1" style={{ color: "var(--sbv-purple)" }}>Deposit amount</label>
                          <div className="flex items-center gap-2">
                            <span style={{ color: "var(--sbv-purple)" }}>$</span>
                            <input type="number" min="0" step="100"
                              value={tbdDepositDollars}
                              onChange={(e) => setTbdDepositDollars(e.target.value)}
                              className="rounded-sm px-3 py-2 text-sm w-40"
                              style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }} />
                          </div>
                          <p className="text-xs italic mt-1" style={{ color: "#6B6B6B" }}>
                            This deposit will be credited toward Invoice #1 when you finalize the package.
                          </p>
                        </div>
                      </div>
                    )}
                  </section>

                  {weddingDateISO && (confirmedConflict || tbdConflictCount > 0) && (
                    <section className="rounded-sm p-4 space-y-2" style={{ background: confirmedConflict ? "#FFF5C2" : "rgba(255,255,255,0.4)", border: "1px solid rgba(65,25,40,0.18)" }}>
                      {confirmedConflict && (
                        <>
                          <h4 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Date conflict</h4>
                          <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                            This date is already confirmed for {confirmedConflict.couple}. You can still create a TBD hold, but only one confirmed booking can exist per date.
                          </p>
                        </>
                      )}
                      {tbdConflictCount > 0 && !confirmedConflict && (
                        <p className="text-xs" style={{ color: "var(--sbv-purple)" }}>
                          {tbdConflictCount} other date hold{tbdConflictCount === 1 ? "" : "s"} exist for this date.
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="px-7 py-4 flex justify-end items-center gap-4" style={{ borderTop: "1px solid rgba(65,25,40,0.18)" }}>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--sbv-purple)" }}>Cancel</button>
          {mode === "package" ? (
            <button
              onClick={handleConfirmPackage}
              disabled={submitting || !calcArr || !bundle?.templateId}
              className="px-5 py-2.5 rounded-sm text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--sbv-green)" }}
            >
              {submitting ? "Creating…" : "Confirm booking & create invoices"}
            </button>
          ) : (
            <button
              onClick={handleConfirmTbd}
              disabled={submitting || !weddingDateISO || depositCents <= 0}
              className="px-5 py-2.5 rounded-sm text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--sbv-green)" }}
            >
              {submitting ? "Creating…" : `Create date hold & generate ${fmtCents(depositCents)} deposit invoice`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCard({ selected, onClick, title, subtitle, disabled }: { selected: boolean; onClick: () => void; title: string; subtitle: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="text-left rounded-sm p-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: selected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
        border: selected ? "2px solid var(--sbv-green)" : "1px solid rgba(65,25,40,0.18)",
      }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-block h-4 w-4 rounded-full border-2" style={{ borderColor: "var(--sbv-green)", background: selected ? "var(--sbv-green)" : "transparent" }} />
        <div>
          <p className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>{title}</p>
          <p className="text-xs mt-1" style={{ color: "var(--sbv-purple)" }}>{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function ScheduleTable({ bundle, calcArr, studioReceives, clientPays }: { bundle: Bundle; calcArr: any[]; studioReceives: number; clientPays: number }) {
  return (
    <section>
      <h3 className="font-serif text-xl mb-3" style={{ color: "var(--sbv-green)" }}>
        Payment schedule preview
        {bundle.templateName && <span className="font-sans text-sm ml-2" style={{ color: "var(--sbv-purple)" }}>· {bundle.templateName}</span>}
      </h3>
      <div className="rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.35)" }}>
        <div className={`grid ${bundle.addProcessingFees ? "grid-cols-[28px_1.4fr_1fr_1fr_1fr_1fr]" : "grid-cols-[28px_1.6fr_1fr_1fr]"} px-4 py-2 text-[10px] uppercase tracking-[0.14em]`} style={{ color: "var(--sbv-purple)" }}>
          <span>#</span><span>Label</span><span>Due</span>
          {bundle.addProcessingFees ? (<><span className="text-right">Subtotal</span><span className="text-right">Fee</span><span className="text-right">Client pays</span></>) : (<span className="text-right">Amount</span>)}
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(65,25,40,0.12)" }}>
          {calcArr.map((r) => (
            <div key={r.index} className={`grid ${bundle.addProcessingFees ? "grid-cols-[28px_1.4fr_1fr_1fr_1fr_1fr]" : "grid-cols-[28px_1.6fr_1fr_1fr]"} px-4 py-2.5 text-sm items-center`} style={{ color: "var(--sbv-purple)" }}>
              <span>{r.index + 1}</span>
              <span>{r.label} <span className="opacity-60 text-xs">({r.percentage}%)</span></span>
              <span>{new Date(r.due_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
              {bundle.addProcessingFees ? (
                <>
                  <span className="text-right">{fmtCents(r.subtotal_cents)}</span>
                  <span className="text-right">{fmtCents(r.processing_fee_cents)}</span>
                  <span className="text-right font-medium">{fmtCents(r.total_cents)}</span>
                </>
              ) : (
                <span className="text-right font-medium">{fmtCents(r.total_cents)}</span>
              )}
            </div>
          ))}
        </div>
        <div className="px-4 py-3 flex flex-col gap-1 text-sm" style={{ borderTop: "1px solid rgba(65,25,40,0.18)" }}>
          {bundle.addProcessingFees ? (
            <>
              <div className="flex justify-between font-serif font-bold" style={{ color: "var(--sbv-green)" }}>
                <span>Studio receives</span><span>{fmtCents(studioReceives)}</span>
              </div>
              <div className="flex justify-between font-serif font-bold foil-gold">
                <span>Client pays total</span><span>{fmtCents(clientPays)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between font-serif font-bold" style={{ color: "var(--sbv-green)" }}>
              <span>Total</span><span>{fmtCents(clientPays)}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
