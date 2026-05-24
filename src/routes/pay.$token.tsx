import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { shortDate } from "@/lib/dates";
import { Check, Clock, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/pay/$token")({
  component: PayPage,
  head: () => ({
    meta: [
      { title: "Pay — Stories by Victoria" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
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

type PayData = {
  couple: { name_1: string | null; name_2: string | null; wedding_date: string | null };
  invoices: Invoice[];
  has_pending_change: boolean;
};

const PAID_STATES = new Set(["paid", "refunded"]);
const DEAD_STATES = new Set(["cancelled", "kill_fee", "refunded"]);

function dollars(cents: number | null | undefined) {
  const n = ((cents ?? 0) / 100);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

function PayPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<PayData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "invalid">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/couple-invoices/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) { setState("invalid"); return; }
        const json = (await r.json()) as PayData;
        setData(json);
        setState("ok");
      })
      .catch(() => { if (!cancelled) setState("invalid"); });
    return () => { cancelled = true; };
  }, [token]);

  if (state === "loading") {
    return (
      <Shell>
        <p className="font-serif italic text-xl" style={{ color: "var(--sbv-green)" }}>Loading…</p>
      </Shell>
    );
  }

  if (state === "invalid" || !data) {
    return (
      <Shell>
        <div className="text-center py-16">
          <h1 className="font-serif text-3xl mb-3" style={{ color: "var(--sbv-green)" }}>This payment link isn't valid</h1>
          <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
            Please check the link or reach out to your photographer.
          </p>
        </div>
      </Shell>
    );
  }

  const { couple, invoices, has_pending_change } = data;
  const coupleName = [couple.name_1, couple.name_2].filter(Boolean).join(" & ") || "Welcome";

  const total = invoices.filter(i => !DEAD_STATES.has(i.status) || i.status === "refunded" ? false : false ? 0 : true).reduce((a,b)=>a+(b.total_cents??0),0);
  const allLive = invoices.filter(i => !["cancelled","kill_fee"].includes(i.status));
  const sumTotal = allLive.reduce((a,b) => a + (b.total_cents ?? 0), 0);
  const sumPaid = allLive.filter(i => PAID_STATES.has(i.status)).reduce((a,b) => a + (b.total_cents ?? 0), 0);
  const sumRemaining = sumTotal - sumPaid;

  // Next-due: earliest due_date among unpaid, non-cancelled, non-refunded
  const unpaid = allLive
    .filter(i => !PAID_STATES.has(i.status))
    .sort((a,b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const nextDueId = !has_pending_change ? unpaid[0]?.id ?? null : null;

  const isEmpty = invoices.length === 0;
  const allPaid = !isEmpty && allLive.length > 0 && allLive.every(i => PAID_STATES.has(i.status));

  return (
    <Shell>
      <header className="text-center mb-10">
        <p className="text-[11px] uppercase tracking-[0.25em] mb-3" style={{ color: "var(--sbv-purple)" }}>
          Stories by Victoria
        </p>
        <h1 className="font-serif text-5xl md:text-6xl mb-2" style={{ color: "var(--sbv-green)", fontStyle: "italic" }}>
          {coupleName}
        </h1>
        {couple.wedding_date && (
          <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>{shortDate(couple.wedding_date)}</p>
        )}
      </header>

      {isEmpty ? (
        <Card>
          <p className="font-serif italic text-xl text-center" style={{ color: "var(--sbv-green)" }}>
            No payments scheduled yet.
          </p>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <Card>
            <div className="grid grid-cols-3 gap-4 text-center">
              <Stat label="Total" value={dollars(sumTotal)} />
              <Stat label="Paid" value={dollars(sumPaid)} />
              <Stat label="Remaining" value={dollars(sumRemaining)} highlight />
            </div>
          </Card>

          {allPaid && (
            <div className="my-8 text-center">
              <p className="font-serif italic text-2xl" style={{ color: "var(--sbv-green)" }}>
                You're all paid up — thank you.
              </p>
            </div>
          )}

          {has_pending_change && !allPaid && (
            <div className="my-6 rounded-lg p-4 text-center" style={{ background: "rgba(180,30,100,0.08)", border: "1px solid var(--sbv-fuchsia)" }}>
              <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                <strong>Pending change.</strong> Your photographer has proposed an update — payments are paused until it's finalized.
              </p>
            </div>
          )}

          {/* Schedule */}
          <div className="mt-8 space-y-3">
            {invoices.map((inv) => {
              const paid = PAID_STATES.has(inv.status);
              const cancelled = ["cancelled","kill_fee"].includes(inv.status);
              const overdue = inv.status === "overdue";
              const isNext = inv.id === nextDueId;
              const pendingBlocked = has_pending_change && !paid && !cancelled;

              return (
                <div
                  key={inv.id}
                  className="rounded-lg p-5 flex items-center justify-between gap-4"
                  style={{
                    background: isNext ? "var(--sbv-pink)" : "rgba(240,165,190,0.35)",
                    border: isNext ? "2px solid var(--sbv-green)" : "1px solid rgba(65,25,40,0.15)",
                    opacity: cancelled ? 0.5 : 1,
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {paid ? (
                      <Check size={20} style={{ color: "var(--sbv-green)" }} />
                    ) : overdue ? (
                      <AlertCircle size={20} style={{ color: "var(--sbv-fuchsia)" }} />
                    ) : (
                      <Clock size={20} style={{ color: "var(--sbv-purple)" }} />
                    )}
                    <div className="min-w-0">
                      <p className="font-serif italic text-xl truncate" style={{ color: "var(--sbv-green)" }}>
                        {inv.label ?? "Invoice"}
                      </p>
                      <p className="text-xs" style={{ color: "var(--sbv-purple)" }}>
                        {paid && inv.paid_at ? `Paid ${shortDate(inv.paid_at)}`
                          : cancelled ? "Cancelled"
                          : pendingBlocked ? "Pending — not yet finalized"
                          : inv.due_date ? `Due ${shortDate(inv.due_date)}`
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>
                      {dollars(inv.total_cents)}
                    </p>
                    {isNext && (
                      <button
                        onClick={() => toast.info("Payment coming soon", { description: "Card payments will be enabled shortly." })}
                        className="mt-2 px-5 py-2 rounded-md text-sm font-medium"
                        style={{ background: "var(--sbv-green)", color: "var(--sbv-ivory)" }}
                      >
                        Pay {dollars(inv.total_cents)}
                      </button>
                    )}
                    {paid && (
                      <p className="text-[11px] uppercase tracking-wider mt-1" style={{ color: "var(--sbv-green)" }}>Paid</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <footer className="mt-16 text-center">
        <p className="text-[11px] uppercase tracking-[0.25em] foil-gold inline-block">
          Powered by Stories by Victoria
        </p>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full py-12 px-4" style={{ background: "var(--sbv-ivory)" }}>
      <div className="max-w-[640px] mx-auto">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-6" style={{ background: "var(--sbv-pink)", border: "1px solid rgba(65,25,40,0.1)" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: "var(--sbv-purple)" }}>{label}</p>
      <p className="font-serif text-2xl" style={{ color: highlight ? "var(--sbv-green)" : "var(--sbv-purple)", fontWeight: highlight ? 600 : 400 }}>
        {value}
      </p>
    </div>
  );
}
