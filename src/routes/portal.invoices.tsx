import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { shortDate } from "@/lib/dates";
import { toast } from "sonner";
import { Check, Clock, AlertCircle, Receipt } from "lucide-react";

export const Route = createFileRoute("/portal/invoices")({
  validateSearch: (s: Record<string, unknown>) => ({
    paid: s.paid === "1" || s.paid === 1 ? true : false,
  }),
  component: () => (
    <PortalGate>
      {({ clientId, client }) => <PortalInvoices clientId={clientId} client={client} />}
    </PortalGate>
  ),
});

type Invoice = {
  id: string;
  label: string | null;
  due_date: string | null;
  total_cents: number | null;
  status: string;
  sequence_order: number | null;
  paid_at: string | null;
};

const PAID_STATES = new Set(["paid", "refunded"]);
const CANCELLED_STATES = new Set(["cancelled", "kill_fee"]);

function dollars(cents: number | null | undefined) {
  const n = (cents ?? 0) / 100;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}

function PortalInvoices({ clientId, client }: { clientId: string; client: any }) {
  const { paid: paidReturn } = useSearch({ from: "/portal/invoices" });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [invRes, pendingRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, label, due_date, total_cents, status, sequence_order, paid_at")
          .eq("client_id", clientId)
          .order("sequence_order", { ascending: true, nullsFirst: false })
          .order("due_date", { ascending: true }),
        supabase
          .from("pending_changes")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "pending")
          .limit(1),
      ]);
      if (cancelled) return;
      setInvoices((invRes.data ?? []) as Invoice[]);
      setHasPendingChange((pendingRes.data?.length ?? 0) > 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function startCheckout(invoiceId: string) {
    if (checkoutLoadingId) return;
    setCheckoutLoadingId(invoiceId);
    try {
      // Look up a view_token for this invoice (RLS lets the client read their own recipients)
      const { data: recipient } = await supabase
        .from("invoice_recipients")
        .select("view_token")
        .eq("invoice_id", invoiceId)
        .limit(1)
        .maybeSingle();

      const token = recipient?.view_token;
      if (!token) {
        toast.error("This invoice isn't ready for online payment yet. Please contact your photographer.");
        setCheckoutLoadingId(null);
        return;
      }

      const res = await fetch(`/api/public/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view_token: token, invoice_id: invoiceId }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json.url) {
        const messages: Record<string, string> = {
          already_paid: "This invoice is already paid.",
          cancelled: "This invoice has been cancelled.",
          pending_change: "Payments are paused while a pending change is finalized.",
          forbidden: "This invoice doesn't belong to you.",
          stripe_not_configured: "Payments aren't set up yet. Please contact your photographer.",
        };
        toast.error(messages[json?.error] ?? "Couldn't start checkout. Please try again.");
        setCheckoutLoadingId(null);
        return;
      }
      window.location.href = json.url as string;
    } catch {
      toast.error("Couldn't start checkout. Please try again.");
      setCheckoutLoadingId(null);
    }
  }

  if (loading) {
    return <p className="font-serif italic text-xl text-primary">Loading…</p>;
  }

  const live = invoices.filter((i) => !CANCELLED_STATES.has(i.status));
  const sumTotal = live.reduce((a, b) => a + (b.total_cents ?? 0), 0);
  const sumPaid = live
    .filter((i) => PAID_STATES.has(i.status))
    .reduce((a, b) => a + (b.total_cents ?? 0), 0);
  const sumRemaining = sumTotal - sumPaid;

  const unpaid = live
    .filter((i) => !PAID_STATES.has(i.status))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const nextDueId = !hasPendingChange ? unpaid[0]?.id ?? null : null;

  const isEmpty = invoices.length === 0;
  const allPaid = !isEmpty && live.length > 0 && live.every((i) => PAID_STATES.has(i.status));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-3xl text-primary">Invoices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your payment schedule with Stories by Victoria.
        </p>
      </header>

      {paidReturn && (
        <div className="rounded-lg p-5 text-center border border-gold bg-gold/10">
          <p className="font-serif italic text-xl text-primary mb-1">
            Thank you — confirming your payment.
          </p>
          <p className="text-xs text-muted-foreground">
            Your card was processed. We're verifying with our payment provider; your schedule will update once confirmed.
          </p>
        </div>
      )}

      {isEmpty ? (
        <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
          <Receipt className="mx-auto text-gold mb-4" size={32} />
          <p className="font-serif italic text-2xl text-primary">No payments scheduled yet.</p>
          <p className="text-sm text-muted-foreground mt-3">
            Your photographer will send a payment schedule once your booking is finalized.
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
            <div className="grid grid-cols-3 gap-4 text-center">
              <Stat label="Total" value={dollars(sumTotal)} />
              <Stat label="Paid" value={dollars(sumPaid)} />
              <Stat label="Remaining" value={dollars(sumRemaining)} highlight />
            </div>
          </div>

          {allPaid && (
            <div className="text-center py-4">
              <p className="font-serif italic text-2xl text-primary">
                You're all paid up — thank you.
              </p>
            </div>
          )}

          {hasPendingChange && !allPaid && (
            <div className="rounded-lg p-4 text-center border border-magenta/40 bg-magenta/5">
              <p className="text-sm text-primary">
                <strong>Pending change.</strong> Your photographer has proposed an update — payments are paused until it's finalized.
              </p>
            </div>
          )}

          {/* Schedule */}
          <div className="space-y-3">
            {invoices.map((inv) => {
              const paid = PAID_STATES.has(inv.status);
              const cancelled = CANCELLED_STATES.has(inv.status);
              const overdue = inv.status === "overdue";
              const isNext = inv.id === nextDueId;
              const pendingBlocked = hasPendingChange && !paid && !cancelled;
              const loadingThis = checkoutLoadingId === inv.id;

              return (
                <div
                  key={inv.id}
                  className={`rounded-lg p-5 flex items-center justify-between gap-4 bg-surface ${
                    isNext ? "border-2 border-gold shadow-soft" : "border border-border"
                  }`}
                  style={{ opacity: cancelled ? 0.5 : 1 }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {paid ? (
                      <Check size={20} className="text-gold shrink-0" />
                    ) : overdue ? (
                      <AlertCircle size={20} className="text-magenta shrink-0" />
                    ) : (
                      <Clock size={20} className="text-primary/60 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-serif italic text-xl text-primary truncate">
                        {inv.label ?? "Invoice"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {paid && inv.paid_at
                          ? `Paid ${shortDate(inv.paid_at)}`
                          : cancelled
                          ? "Cancelled"
                          : pendingBlocked
                          ? "Pending — not yet finalized"
                          : inv.due_date
                          ? `Due ${shortDate(inv.due_date)}`
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-serif text-2xl text-primary">{dollars(inv.total_cents)}</p>
                    {isNext && (
                      <button
                        onClick={() => startCheckout(inv.id)}
                        disabled={loadingThis}
                        className="mt-2 px-5 py-2 rounded-md text-sm font-medium bg-primary text-background hover:opacity-90 disabled:opacity-60"
                      >
                        {loadingThis ? "Opening checkout…" : `Pay ${dollars(inv.total_cents)}`}
                      </button>
                    )}
                    {paid && (
                      <p className="text-[11px] uppercase tracking-wider mt-1 text-gold">Paid</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{label}</p>
      <p
        className={`font-serif text-2xl ${highlight ? "text-primary font-semibold" : "text-primary/80"}`}
      >
        {value}
      </p>
    </div>
  );
}
