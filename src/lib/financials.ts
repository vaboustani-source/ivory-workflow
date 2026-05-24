import { supabase } from "@/integrations/supabase/client";

export interface FinancialSnapshot {
  revenue: number;
  contractor_costs: number; // legacy: from contractor_service_requests (kept for back-compat)
  crew_cost_cents: number;  // NEW: from wedding_team.agreed_total
  line_item_cost_cents: number; // NEW: from quote_item_cost_snapshots
  editing_cost: number;
  other_expenses: number;
  overhead_allocation_cents: number; // NEW: allocated overhead per wedding
  total_costs: number; // direct costs only (crew + line_item + editing + other)
  profit: number; // legacy = revenue - total_costs (gross, before overhead)
  margin: number | null; // legacy
  gross_profit_cents: number; // revenue (cents) - direct cost (cents)
  net_profit_cents: number;   // gross - overhead
  net_margin_pct: number | null;
  crew_cost_incomplete: boolean; // any wedding_team row with null agreed_total
}

export interface ClientLite {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  status: string;
}

function compute(parts: {
  revenue: number;
  crew_cost_cents: number;
  line_item_cost_cents: number;
  editing_cost: number;
  other_expenses: number;
  overhead_allocation_cents: number;
  contractor_costs?: number;
  crew_cost_incomplete?: boolean;
}): FinancialSnapshot {
  const crew_dollars = parts.crew_cost_cents / 100;
  const line_item_dollars = parts.line_item_cost_cents / 100;
  const overhead_dollars = parts.overhead_allocation_cents / 100;
  const direct_cost_dollars = crew_dollars + line_item_dollars + parts.editing_cost + parts.other_expenses;
  const gross_profit_dollars = parts.revenue - direct_cost_dollars;
  const net_profit_dollars = gross_profit_dollars - overhead_dollars;
  return {
    revenue: parts.revenue,
    contractor_costs: parts.contractor_costs ?? crew_dollars,
    crew_cost_cents: parts.crew_cost_cents,
    line_item_cost_cents: parts.line_item_cost_cents,
    editing_cost: parts.editing_cost,
    other_expenses: parts.other_expenses,
    overhead_allocation_cents: parts.overhead_allocation_cents,
    total_costs: direct_cost_dollars,
    profit: gross_profit_dollars,
    margin: parts.revenue > 0 ? (gross_profit_dollars / parts.revenue) * 100 : null,
    gross_profit_cents: Math.round(gross_profit_dollars * 100),
    net_profit_cents: Math.round(net_profit_dollars * 100),
    net_margin_pct: parts.revenue > 0 ? (net_profit_dollars / parts.revenue) * 100 : null,
    crew_cost_incomplete: parts.crew_cost_incomplete ?? false,
  };
}

export interface ContractorBreakdownRow {
  id: string;
  contractor_name: string;
  role: string;
  amount: number;
}

export interface OverheadModel {
  annual_overhead_cents: number;
  expected_weddings_per_year: number;
  overhead_per_wedding_cents: number;
}

export async function getOverheadModel(): Promise<OverheadModel> {
  const [{ data: items }, { data: settings }] = await Promise.all([
    supabase.from("studio_overhead_items").select("amount_cents, cadence, is_active").eq("is_active", true),
    supabase.from("studio_cost_settings").select("expected_weddings_per_year").limit(1).maybeSingle(),
  ]);
  const annual = (items ?? []).reduce((s: number, r: any) => {
    const amt = Number(r.amount_cents ?? 0);
    return s + (r.cadence === "monthly" ? amt * 12 : amt);
  }, 0);
  const expected = Math.max(1, Number((settings as any)?.expected_weddings_per_year ?? 25));
  return {
    annual_overhead_cents: annual,
    expected_weddings_per_year: expected,
    overhead_per_wedding_cents: Math.floor(annual / expected),
  };
}

async function fetchClientCrewAndLineItems(clientIds: string[]): Promise<{
  crew: Map<string, { total_cents: number; incomplete: boolean }>;
  lineItems: Map<string, number>;
}> {
  const crew = new Map<string, { total_cents: number; incomplete: boolean }>();
  const lineItems = new Map<string, number>();
  if (clientIds.length === 0) return { crew, lineItems };

  const { data: teamRows } = await supabase
    .from("wedding_team")
    .select("client_id, agreed_total")
    .in("client_id", clientIds);
  (teamRows ?? []).forEach((r: any) => {
    const cur = crew.get(r.client_id) ?? { total_cents: 0, incomplete: false };
    if (r.agreed_total == null) cur.incomplete = true;
    else cur.total_cents += Number(r.agreed_total);
    crew.set(r.client_id, cur);
  });

  // line item cost: only for accepted quotes
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, client_id, status")
    .in("client_id", clientIds)
    .eq("status", "accepted");
  const quoteIds = (quotes ?? []).map((q: any) => q.id);
  const quoteToClient = new Map<string, string>();
  (quotes ?? []).forEach((q: any) => quoteToClient.set(q.id, q.client_id));
  if (quoteIds.length > 0) {
    const { data: items } = await supabase
      .from("quote_items")
      .select("id, quote_id, quantity, cost_snap:quote_item_cost_snapshots(cost_cents_snapshot)")
      .in("quote_id", quoteIds);
    (items ?? []).forEach((r: any) => {
      const snap = Array.isArray(r.cost_snap) ? r.cost_snap[0] : r.cost_snap;
      const cents = Number(snap?.cost_cents_snapshot ?? 0);
      const qty = Number(r.quantity ?? 0);
      const cid = quoteToClient.get(r.quote_id);
      if (!cid) return;
      lineItems.set(cid, (lineItems.get(cid) ?? 0) + cents * qty);
    });
  }
  return { crew, lineItems };
}

export async function getClientFinancials(clientId: string): Promise<{
  snapshot: FinancialSnapshot;
  contractors: ContractorBreakdownRow[];
  expenses: { id: string; description: string; category: string; amount: number; expense_date: string | null }[];
  client: { final_image_count: number | null; editing_rate_per_image: number | null; package_price: number | null };
  overhead: OverheadModel;
}> {
  const [{ data: client }, { data: csr }, { data: exp }, { data: quote }, breakdowns, overhead] = await Promise.all([
    supabase.from("clients").select("package_price, final_image_count, editing_rate_per_image").eq("id", clientId).maybeSingle(),
    supabase
      .from("contractor_service_requests")
      .select("id, agreed_total, role, contractor:contractors!contractor_service_requests_contractor_id_fkey(full_name)")
      .eq("client_id", clientId)
      .eq("status", "accepted"),
    supabase.from("wedding_expenses").select("id, description, category, amount, expense_date").eq("client_id", clientId).order("expense_date", { ascending: false }),
    supabase.from("quotes").select("total_cents").eq("client_id", clientId).maybeSingle(),
    fetchClientCrewAndLineItems([clientId]),
    getOverheadModel(),
  ]);

  const revenue = quote?.total_cents != null
    ? Number(quote.total_cents) / 100
    : Number(client?.package_price ?? 0);
  const contractors: ContractorBreakdownRow[] = (csr ?? []).map((r: any) => ({
    id: r.id,
    contractor_name: r.contractor?.full_name ?? "Contractor",
    role: r.role,
    amount: Number(r.agreed_total ?? 0) / 100,
  }));

  const crewInfo = breakdowns.crew.get(clientId) ?? { total_cents: 0, incomplete: false };
  const lineItemCents = breakdowns.lineItems.get(clientId) ?? 0;

  const imageCount = Number(client?.final_image_count ?? 0);
  const rate = Number(client?.editing_rate_per_image ?? 0);
  const editing_cost = imageCount * rate;

  const expenses = (exp ?? []).map((e: any) => ({ ...e, amount: Number(e.amount) }));
  const other_expenses = expenses.reduce((s, r) => s + r.amount, 0);

  return {
    snapshot: compute({
      revenue,
      crew_cost_cents: crewInfo.total_cents,
      line_item_cost_cents: lineItemCents,
      editing_cost,
      other_expenses,
      overhead_allocation_cents: overhead.overhead_per_wedding_cents,
      crew_cost_incomplete: crewInfo.incomplete,
    }),
    contractors,
    expenses,
    client: {
      final_image_count: client?.final_image_count ?? null,
      editing_rate_per_image: client?.editing_rate_per_image != null ? Number(client.editing_rate_per_image) : null,
      package_price: client?.package_price != null ? Number(client.package_price) : null,
    },
    overhead,
  };
}

export async function getStudioFinancials(year: number, statusFilter?: string[]): Promise<{
  snapshots: { client: ClientLite; financials: FinancialSnapshot }[];
  totals: FinancialSnapshot;
  overhead: OverheadModel;
  actual_booked_this_year: number;
}> {
  const overhead = await getOverheadModel();

  let q = supabase
    .from("clients")
    .select("id, couple_name_1, couple_name_2, wedding_date, status, package_price, final_image_count, editing_rate_per_image")
    .gte("wedding_date", `${year}-01-01`)
    .lte("wedding_date", `${year}-12-31`);
  if (statusFilter && statusFilter.length) q = q.in("status", statusFilter as any);
  const { data: clients } = await q;
  const ids = (clients ?? []).map((c) => c.id);

  // actual booked this year (independent of statusFilter)
  const { count: bookedCount } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .in("status", ["booked", "active", "delivered", "complete"] as any)
    .gte("wedding_date", `${year}-01-01`)
    .lte("wedding_date", `${year}-12-31`);
  const actual_booked_this_year = bookedCount ?? 0;

  if (ids.length === 0) {
    return {
      snapshots: [],
      totals: compute({ revenue: 0, crew_cost_cents: 0, line_item_cost_cents: 0, editing_cost: 0, other_expenses: 0, overhead_allocation_cents: 0 }),
      overhead,
      actual_booked_this_year,
    };
  }

  const [{ data: exps }, { data: quotes }, breakdowns] = await Promise.all([
    supabase.from("wedding_expenses").select("client_id, amount").in("client_id", ids),
    supabase.from("quotes").select("client_id, total_cents").in("client_id", ids),
    fetchClientCrewAndLineItems(ids),
  ]);

  const expMap = new Map<string, number>();
  (exps ?? []).forEach((r: any) => expMap.set(r.client_id, (expMap.get(r.client_id) ?? 0) + Number(r.amount ?? 0)));
  const quoteMap = new Map<string, number>();
  (quotes ?? []).forEach((r: any) => quoteMap.set(r.client_id, Number(r.total_cents ?? 0) / 100));

  const snapshots = (clients ?? []).map((c: any) => {
    const revenue = quoteMap.has(c.id) ? quoteMap.get(c.id)! : Number(c.package_price ?? 0);
    const crewInfo = breakdowns.crew.get(c.id) ?? { total_cents: 0, incomplete: false };
    const line_item_cost_cents = breakdowns.lineItems.get(c.id) ?? 0;
    const editing_cost = Number(c.final_image_count ?? 0) * Number(c.editing_rate_per_image ?? 0);
    const other_expenses = expMap.get(c.id) ?? 0;
    return {
      client: { id: c.id, couple_name_1: c.couple_name_1, couple_name_2: c.couple_name_2, wedding_date: c.wedding_date, status: c.status },
      financials: compute({
        revenue,
        crew_cost_cents: crewInfo.total_cents,
        line_item_cost_cents,
        editing_cost,
        other_expenses,
        overhead_allocation_cents: overhead.overhead_per_wedding_cents,
        crew_cost_incomplete: crewInfo.incomplete,
      }),
    };
  });

  const totals = compute({
    revenue: snapshots.reduce((s, r) => s + r.financials.revenue, 0),
    crew_cost_cents: snapshots.reduce((s, r) => s + r.financials.crew_cost_cents, 0),
    line_item_cost_cents: snapshots.reduce((s, r) => s + r.financials.line_item_cost_cents, 0),
    editing_cost: snapshots.reduce((s, r) => s + r.financials.editing_cost, 0),
    other_expenses: snapshots.reduce((s, r) => s + r.financials.other_expenses, 0),
    overhead_allocation_cents: snapshots.length * overhead.overhead_per_wedding_cents,
    crew_cost_incomplete: snapshots.some((r) => r.financials.crew_cost_incomplete),
  });

  return { snapshots, totals, overhead, actual_booked_this_year };
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
export function fmtMoneyCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}
export function fmtMoneyDecimal(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtMargin(m: number | null): string {
  return m == null ? "—" : `${m.toFixed(1)}%`;
}
