import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calculateSchedule, fmtCents, type FeeSettings, type InstallmentInput } from "@/lib/invoiceMath";

interface Props {
  open: boolean;
  clientId: string | null;
  coupleLabel: string;
  weddingDateISO: string | null;
  depositCents: number;
  currentPackageId: string | null;
  onClose: () => void;
  onFinalized: () => void;
}

interface PkgRow {
  id: string;
  name: string;
  base_price: number | null;
  add_processing_fees: boolean;
  default_payment_schedule_template_id: string | null;
}

export function FinalizationModal({ open, clientId, coupleLabel, weddingDateISO, depositCents, currentPackageId, onClose, onFinalized }: Props) {
  const [packages, setPackages] = useState<PkgRow[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [fees, setFees] = useState<FeeSettings | null>(null);
  const [packageId, setPackageId] = useState<string | null>(currentPackageId ?? null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<{ couple: string } | null>(null);
  const [confirmConflict, setConfirmConflict] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: pkgs }, { data: tpls }, { data: feeRows }] = await Promise.all([
        supabase.from("packages").select("id, name, base_price, add_processing_fees, default_payment_schedule_template_id").eq("is_active", true).order("name"),
        supabase.from("payment_schedule_templates").select("id, name").eq("is_active", true).order("name"),
        supabase.from("processing_fee_settings").select("stripe_percentage, stripe_flat_cents").limit(1),
      ]);
      if (cancelled) return;
      setPackages((pkgs ?? []) as PkgRow[]);
      setTemplates((tpls ?? []) as any);
      setFees(feeRows?.[0] ? { stripe_percentage: Number(feeRows[0].stripe_percentage), stripe_flat_cents: Number(feeRows[0].stripe_flat_cents) } : null);

      // Conflict check
      if (clientId && weddingDateISO) {
        const { data: cs } = await supabase.from("clients")
          .select("id, couple_name_1, couple_name_2, is_tbd_booking")
          .eq("wedding_date", weddingDateISO).eq("status", "booked").neq("id", clientId);
        const c = (cs ?? []).find((r: any) => !r.is_tbd_booking);
        setConflict(c ? { couple: `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}` } : null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, clientId, weddingDateISO]);

  // When package changes, set its default template
  useEffect(() => {
    if (!packageId) return;
    const p = packages.find((x) => x.id === packageId);
    if (p?.default_payment_schedule_template_id) setTemplateId(p.default_payment_schedule_template_id);
  }, [packageId, packages]);

  // Load installments when template changes
  useEffect(() => {
    if (!templateId) { setInstallments([]); return; }
    (async () => {
      const { data } = await supabase.from("payment_schedule_template_installments")
        .select("sequence_order, label, percentage, due_offset_type, due_offset_days")
        .eq("template_id", templateId).order("sequence_order");
      setInstallments((data ?? []).map((i: any) => ({
        sequence_order: i.sequence_order, label: i.label,
        percentage: Number(i.percentage), due_offset_type: i.due_offset_type,
        due_offset_days: i.due_offset_days,
      })));
    })();
  }, [templateId]);

  const pkg = packages.find((p) => p.id === packageId) ?? null;
  const basePriceCents = pkg ? Math.round(Number(pkg.base_price ?? 0) * 100) : 0;

  const calcArr = useMemo(() => {
    if (!pkg || installments.length === 0 || basePriceCents === 0) return null;
    try {
      return calculateSchedule({
        basePriceCents, addProcessingFees: pkg.add_processing_fees, fees,
        installments, weddingDateISO,
      });
    } catch { return null; }
  }, [pkg, installments, basePriceCents, fees, weddingDateISO]);

  // Apply deposit credit to preview
  const calcWithCredit = useMemo(() => {
    if (!calcArr) return null;
    let remaining = depositCents;
    return calcArr.map((r) => {
      const apply = Math.min(remaining, r.total_cents);
      remaining -= apply;
      return { ...r, deposit_applied_cents: apply, total_after_credit: r.total_cents - apply };
    });
  }, [calcArr, depositCents]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!clientId || !packageId || !templateId) return;
    if (conflict && !confirmConflict) { setConfirmConflict(true); return; }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc("finalize_tbd_booking", {
      p_client_id: clientId, p_template_id: templateId, p_package_id: packageId, p_overrides: [],
    });
    setSubmitting(false);
    if (rpcErr) { toast.error(`Couldn't finalize: ${rpcErr.message}`); return; }
    toast.success("Package finalized. Payment schedule generated with deposit credited.");
    onFinalized(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,15,0.45)" }} onClick={onClose}>
      <div className="w-full max-w-[760px] max-h-[90vh] overflow-y-auto rounded-md shadow-xl"
        style={{ background: "var(--sbv-pink-soft)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-7 pt-6">
          <div>
            <h2 className="font-serif text-3xl" style={{ color: "var(--sbv-green)" }}>Finalize package</h2>
            <p className="text-sm mt-1" style={{ color: "var(--sbv-purple)" }}>
              {coupleLabel} · Date-hold deposit of {fmtCents(depositCents)} will be credited.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5" style={{ color: "var(--sbv-purple)" }}><X size={18} /></button>
        </div>

        <div className="px-7 py-5 space-y-6">
          {loading && <p className="text-sm italic" style={{ color: "var(--sbv-purple)" }}>Loading…</p>}

          <section>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--sbv-purple)" }}>Package</label>
            <select value={packageId ?? ""} onChange={(e) => setPackageId(e.target.value || null)}
              className="w-full rounded-sm px-3 py-2 text-sm"
              style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }}>
              <option value="">— Select a package —</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtCents(Math.round(Number(p.base_price ?? 0) * 100))}</option>)}
            </select>
          </section>

          <section>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--sbv-purple)" }}>Payment schedule template</label>
            <select value={templateId ?? ""} onChange={(e) => setTemplateId(e.target.value || null)}
              className="w-full rounded-sm px-3 py-2 text-sm"
              style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }}>
              <option value="">— Select a schedule —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </section>

          {calcWithCredit && pkg && (
            <section>
              <h3 className="font-serif text-xl mb-3" style={{ color: "var(--sbv-green)" }}>Payment schedule preview</h3>
              <div className="rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.35)" }}>
                {calcWithCredit.map((r) => (
                  <div key={r.index} className="px-4 py-2.5 text-sm border-b" style={{ color: "var(--sbv-purple)", borderColor: "rgba(65,25,40,0.12)" }}>
                    <div className="flex justify-between">
                      <span><span className="opacity-60">#{r.index + 1}</span> {r.label} <span className="opacity-60 text-xs">({r.percentage}%)</span></span>
                      <span>{fmtCents(r.total_cents)}</span>
                    </div>
                    {r.deposit_applied_cents > 0 && (
                      <div className="flex justify-between italic mt-1" style={{ color: "var(--sbv-green)" }}>
                        <span>Date-hold deposit applied</span>
                        <span>−{fmtCents(r.deposit_applied_cents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium mt-1">
                      <span>Due {new Date(r.due_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      <span>{fmtCents(r.total_after_credit)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {conflict && confirmConflict && (
            <section className="rounded-sm p-4" style={{ background: "#FFF5C2", border: "1px solid rgba(65,25,40,0.18)" }}>
              <h4 className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>Date conflict</h4>
              <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                {conflict.couple} is already confirmed for this date. Continue anyway?
              </p>
            </section>
          )}
        </div>

        <div className="px-7 py-4 flex justify-end items-center gap-4" style={{ borderTop: "1px solid rgba(65,25,40,0.18)" }}>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--sbv-purple)" }}>Cancel</button>
          <button onClick={handleConfirm}
            disabled={submitting || !packageId || !templateId || !calcWithCredit}
            className="px-5 py-2.5 rounded-sm text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--sbv-green)" }}>
            {submitting ? "Finalizing…" : conflict && !confirmConflict ? "Continue (conflict warning)" : "Finalize & generate schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
