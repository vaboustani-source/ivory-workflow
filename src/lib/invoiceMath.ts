// Mirrors SQL math in public.create_booking_invoices for client-side preview.

export interface FeeSettings { stripe_percentage: number; stripe_flat_cents: number }

export interface InstallmentInput {
  sequence_order: number;
  label: string;
  percentage: number;
  due_offset_type: "on_booking" | "days_after_booking" | "days_before_event";
  due_offset_days: number | null;
}

export interface CalculatedInstallment {
  index: number;
  label: string;
  percentage: number;
  due_date: string; // ISO YYYY-MM-DD
  subtotal_cents: number;
  processing_fee_cents: number;
  total_cents: number;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function calculateSchedule(opts: {
  basePriceCents: number;
  addProcessingFees: boolean;
  fees: FeeSettings | null;
  installments: InstallmentInput[];
  weddingDateISO: string | null;
  overrides?: { installment_index: number; due_date?: string; label?: string }[];
}): CalculatedInstallment[] {
  const today = todayISO();
  const sorted = [...opts.installments].sort((a, b) => a.sequence_order - b.sequence_order);
  return sorted.map((inst, i) => {
    let due: string;
    if (inst.due_offset_type === "on_booking") due = today;
    else if (inst.due_offset_type === "days_after_booking") due = addDaysISO(today, inst.due_offset_days ?? 0);
    else {
      if (!opts.weddingDateISO) throw new Error("Set a wedding date before booking — payment schedule requires it.");
      due = addDaysISO(opts.weddingDateISO, -(inst.due_offset_days ?? 0));
    }
    let label = inst.label;
    const ovr = opts.overrides?.find((o) => o.installment_index === i);
    if (ovr?.due_date) due = ovr.due_date;
    if (ovr?.label) label = ovr.label;

    const net = Math.round((opts.basePriceCents * inst.percentage) / 100);
    let fee = 0, total = net;
    if (opts.addProcessingFees && opts.fees) {
      const gross = Math.ceil((net + opts.fees.stripe_flat_cents) / (1 - opts.fees.stripe_percentage / 100));
      fee = gross - net;
      total = gross;
    }
    return {
      index: i,
      label,
      percentage: inst.percentage,
      due_date: due,
      subtotal_cents: net,
      processing_fee_cents: fee,
      total_cents: total,
    };
  });
}

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
