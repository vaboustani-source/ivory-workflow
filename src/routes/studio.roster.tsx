import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/studio/roster")({
  component: RosterPage,
});

// NOTE: wedding_team.agreed_total holds crew cost (what we pay the contractor).
// TODO(owner-margin-view): this will feed a future per-wedding cost/margin view
// for owners only. Do NOT surface agreed_total in this roster (managers must
// never see crew cost).

type ClientRow = {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string;
  venue_name: string | null;
  coverage_hours: number | null;
  status: string;
  has_album: boolean | null;
  has_videography: boolean | null;
  services_added: any;
};

type WTRow = {
  client_id: string;
  role: string;
  contractor: { id: string; full_name: string } | null;
};

type QuoteItemRow = {
  client_id: string;
  item_type_snapshot: string;
  description_snapshot: string | null;
};

type InvoiceRow = {
  client_id: string;
  status: string;
  total_cents: number | null;
};

type Contractor = {
  id: string;
  full_name: string;
  roles: string[];
  is_active: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fmtUSD(cents: number) {
  return "$" + Math.round(cents / 100).toLocaleString();
}

function RosterPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<string>(String(currentYear));
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<WTRow[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItemRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [cRes, wtRes, qiRes, invRes, conRes] = await Promise.all([
      supabase
        .from("clients")
        .select("id, couple_name_1, couple_name_2, wedding_date, venue_name, coverage_hours, status, has_album, has_videography, services_added")
        .in("status", ["booked", "active"])
        .not("wedding_date", "is", null)
        .order("wedding_date", { ascending: true }),
      supabase
        .from("wedding_team")
        .select("client_id, role, contractor:contractors(id, full_name)"),
      supabase
        .from("quote_items")
        .select("item_type_snapshot, description_snapshot, quote:quotes!inner(client_id, status)")
        .eq("quote.status", "accepted"),
      supabase
        .from("invoices")
        .select("client_id, status, total_cents"),
      supabase
        .from("contractors")
        .select("id, full_name, roles, is_active")
        .eq("is_active", true)
        .order("full_name"),
    ]);

    setClients((cRes.data ?? []) as any);
    setTeam((wtRes.data ?? []) as any);
    const qi: QuoteItemRow[] = ((qiRes.data ?? []) as any[]).map((r) => ({
      client_id: r.quote?.client_id,
      item_type_snapshot: r.item_type_snapshot,
      description_snapshot: r.description_snapshot,
    })).filter((r) => r.client_id);
    setQuoteItems(qi);
    setInvoices((invRes.data ?? []) as any);
    setContractors((conRes.data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const years = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => { if (c.wedding_date) set.add(c.wedding_date.slice(0, 4)); });
    set.add(String(currentYear));
    return Array.from(set).sort();
  }, [clients, currentYear]);

  const filtered = useMemo(() => {
    if (year === "all") return clients;
    return clients.filter((c) => c.wedding_date.startsWith(year));
  }, [clients, year]);

  // Indexes
  const teamByClient = useMemo(() => {
    const map = new Map<string, WTRow[]>();
    team.forEach((t) => {
      const arr = map.get(t.client_id) ?? [];
      arr.push(t);
      map.set(t.client_id, arr);
    });
    return map;
  }, [team]);

  const qiByClient = useMemo(() => {
    const map = new Map<string, QuoteItemRow[]>();
    quoteItems.forEach((q) => {
      const arr = map.get(q.client_id) ?? [];
      arr.push(q);
      map.set(q.client_id, arr);
    });
    return map;
  }, [quoteItems]);

  const invByClient = useMemo(() => {
    const map = new Map<string, { paid: number; total: number; count: number }>();
    invoices.forEach((i) => {
      if (i.status === "cancelled") return;
      const t = i.total_cents ?? 0;
      const cur = map.get(i.client_id) ?? { paid: 0, total: 0, count: 0 };
      cur.total += t;
      cur.count += 1;
      if (i.status === "paid") cur.paid += t;
      map.set(i.client_id, cur);
    });
    return map;
  }, [invoices]);

  const ssOptions = useMemo(
    () => contractors.filter((c) => c.roles?.includes("second_shooter")),
    [contractors],
  );
  const videoOptions = useMemo(
    () => contractors.filter((c) => c.roles?.includes("videographer")),
    [contractors],
  );

  // Detect "included in quote" per role
  function quoteIncludes(clientId: string, kind: "album" | "videography" | "second_shooter", client: ClientRow): boolean {
    const items = qiByClient.get(clientId) ?? [];
    if (kind === "album") {
      if (items.some((i) => i.item_type_snapshot === "album")) return true;
      return !!client.has_album;
    }
    if (kind === "videography") {
      if (items.some((i) => i.item_type_snapshot === "videography")) return true;
      return !!client.has_videography;
    }
    // second_shooter has no enum type — match by description OR services_added
    if (items.some((i) => /second\s*shooter/i.test(i.description_snapshot ?? ""))) return true;
    const sa = client.services_added;
    if (Array.isArray(sa)) {
      return sa.some((v: any) => {
        if (typeof v === "string") return v === "second_shooter";
        return v?.role === "second_shooter";
      });
    }
    return false;
  }

  const assign = async (clientId: string, role: "second_shooter" | "videographer", contractorId: string) => {
    const { error } = await supabase.from("wedding_team").insert({
      client_id: clientId, contractor_id: contractorId, role,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Crew assigned.");
    load();
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary">Roster</h1>
          <p className="text-sm text-muted-foreground mt-1">Every booked wedding, at a glance.</p>
        </div>
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">Year:</span>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-transparent text-foreground focus:outline-none">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-soft overflow-hidden">
        {loading ? (
          <p className="text-center py-16 text-muted-foreground text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="font-serif italic text-lg text-primary text-center py-16">No weddings on the books for {year}.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Couple</th>
                <th className="px-4 py-3 font-medium">Venue</th>
                <th className="px-4 py-3 font-medium">Hours</th>
                <th className="px-4 py-3 font-medium">Album</th>
                <th className="px-4 py-3 font-medium">Second shooter</th>
                <th className="px-4 py-3 font-medium">Video</th>
                <th className="px-4 py-3 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const tRows = teamByClient.get(c.id) ?? [];
                const ss = tRows.find((t) => t.role === "second_shooter");
                const vid = tRows.find((t) => t.role === "videographer");
                const ssIncluded = quoteIncludes(c.id, "second_shooter", c);
                const videoIncluded = quoteIncludes(c.id, "videography", c);
                const albumIncluded = quoteIncludes(c.id, "album", c);
                const inv = invByClient.get(c.id);

                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-background-alt/40">
                    <td className="px-4 py-5 text-sm text-foreground whitespace-nowrap">{fmtDate(c.wedding_date)}</td>
                    <td className="px-4 py-5">
                      <Link to="/studio/clients/$id" params={{ id: c.id }} className="font-serif italic text-base text-primary hover:underline">
                        {c.couple_name_1}{c.couple_name_2 ? " & " + c.couple_name_2 : ""}
                      </Link>
                    </td>
                    <td className="px-4 py-5 text-sm text-foreground">{c.venue_name ?? "—"}</td>
                    <td className="px-4 py-5 text-sm text-foreground">{c.coverage_hours != null ? `${c.coverage_hours}h` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-5"><YesNo on={albumIncluded} /></td>
                    <td className="px-4 py-5">
                      <CrewCell
                        assignedName={ss?.contractor?.full_name ?? null}
                        included={ssIncluded}
                        options={ssOptions}
                        onAssign={(id) => assign(c.id, "second_shooter", id)}
                      />
                    </td>
                    <td className="px-4 py-5">
                      <CrewCell
                        assignedName={vid?.contractor?.full_name ?? null}
                        included={videoIncluded}
                        options={videoOptions}
                        onAssign={(id) => assign(c.id, "videographer", id)}
                      />
                    </td>
                    <td className="px-4 py-5"><PaymentCell inv={inv} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function YesNo({ on }: { on: boolean }) {
  if (on) return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--sage,#103200)]">
      <span className="h-2 w-2 rounded-full bg-sage" /> Yes
    </span>
  );
  return <span className="text-sm text-muted-foreground">No</span>;
}

function CrewCell({
  assignedName, included, options, onAssign,
}: {
  assignedName: string | null;
  included: boolean;
  options: Contractor[];
  onAssign: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (assignedName) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <Check size={14} className="text-sage" />
        {assignedName}
      </span>
    );
  }
  if (!included) {
    return <span className="text-sm text-muted-foreground">N/A</span>;
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-sm rounded-sm px-2 py-1 ${
          included
            ? "bg-gold/15 text-plum hover:bg-gold/25"
            : "text-muted-foreground hover:bg-background-alt/60"
        }`}
        title={included ? "Paid for — not booked yet" : "Not included"}
      >
        {included && <AlertTriangle size={12} />}
        Unassigned
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-30 bg-surface border border-border rounded-sm shadow-elevated min-w-[200px] py-1 max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No contractors available.</p>
            ) : options.map((c) => (
              <button
                key={c.id}
                onClick={() => { setOpen(false); onAssign(c.id); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-background-alt/60 text-foreground"
              >
                {c.full_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaymentCell({ inv }: { inv?: { paid: number; total: number; count: number } }) {
  if (!inv || inv.count === 0) return <span className="text-sm text-muted-foreground">No schedule</span>;
  if (inv.paid === 0) return <span className="text-sm text-muted-foreground">Nothing paid</span>;
  if (inv.paid >= inv.total) return (
    <span className="inline-flex items-center gap-1.5 text-sm text-sage">
      <span className="h-2 w-2 rounded-full bg-sage" /> Paid in full
    </span>
  );
  const pct = Math.round((inv.paid / inv.total) * 100);
  return (
    <div>
      <p className="text-sm text-foreground">{fmtUSD(inv.paid)} of {fmtUSD(inv.total)}</p>
      <div className="mt-1 h-1 w-28 bg-background-alt rounded-full overflow-hidden">
        <div className="h-full bg-plum" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
