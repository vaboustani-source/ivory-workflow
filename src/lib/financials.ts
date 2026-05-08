import { supabase } from "@/integrations/supabase/client";

export interface FinancialSnapshot {
  revenue: number;
  contractor_costs: number;
  editing_cost: number;
  other_expenses: number;
  total_costs: number;
  profit: number;
  margin: number | null;
}

export interface ClientLite {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  status: string;
}

function compute(parts: { revenue: number; contractor_costs: number; editing_cost: number; other_expenses: number }): FinancialSnapshot {
  const total_costs = parts.contractor_costs + parts.editing_cost + parts.other_expenses;
  const profit = parts.revenue - total_costs;
  const margin = parts.revenue > 0 ? (profit / parts.revenue) * 100 : null;
  return { ...parts, total_costs, profit, margin };
}

export interface ContractorBreakdownRow {
  id: string;
  contractor_name: string;
  role: string;
  amount: number;
}

export async function getClientFinancials(clientId: string): Promise<{
  snapshot: FinancialSnapshot;
  contractors: ContractorBreakdownRow[];
  expenses: { id: string; description: string; category: string; amount: number; expense_date: string | null }[];
  client: { final_image_count: number | null; editing_rate_per_image: number | null; package_price: number | null };
}> {
  const [{ data: client }, { data: csr }, { data: exp }] = await Promise.all([
    supabase.from("clients").select("package_price, final_image_count, editing_rate_per_image").eq("id", clientId).maybeSingle(),
    supabase
      .from("contractor_service_requests")
      .select("id, agreed_total, role, contractor:contractors!contractor_service_requests_contractor_id_fkey(full_name)")
      .eq("client_id", clientId)
      .eq("status", "accepted"),
    supabase.from("wedding_expenses").select("id, description, category, amount, expense_date").eq("client_id", clientId).order("expense_date", { ascending: false }),
  ]);

  const revenue = Number(client?.package_price ?? 0);
  const contractors: ContractorBreakdownRow[] = (csr ?? []).map((r: any) => ({
    id: r.id,
    contractor_name: r.contractor?.full_name ?? "Contractor",
    role: r.role,
    amount: Number(r.agreed_total ?? 0),
  }));
  const contractor_costs = contractors.reduce((s, r) => s + r.amount, 0);

  const imageCount = Number(client?.final_image_count ?? 0);
  const rate = Number(client?.editing_rate_per_image ?? 0);
  const editing_cost = imageCount * rate;

  const expenses = (exp ?? []).map((e: any) => ({ ...e, amount: Number(e.amount) }));
  const other_expenses = expenses.reduce((s, r) => s + r.amount, 0);

  return {
    snapshot: compute({ revenue, contractor_costs, editing_cost, other_expenses }),
    contractors,
    expenses,
    client: {
      final_image_count: client?.final_image_count ?? null,
      editing_rate_per_image: client?.editing_rate_per_image != null ? Number(client.editing_rate_per_image) : null,
      package_price: client?.package_price != null ? Number(client.package_price) : null,
    },
  };
}

export async function getStudioFinancials(year: number, statusFilter?: string[]): Promise<{
  snapshots: { client: ClientLite; financials: FinancialSnapshot }[];
  totals: FinancialSnapshot;
}> {
  let q = supabase
    .from("clients")
    .select("id, couple_name_1, couple_name_2, wedding_date, status, package_price, final_image_count, editing_rate_per_image")
    .gte("wedding_date", `${year}-01-01`)
    .lte("wedding_date", `${year}-12-31`);
  if (statusFilter && statusFilter.length) q = q.in("status", statusFilter as any);
  const { data: clients } = await q;
  const ids = (clients ?? []).map((c) => c.id);
  if (ids.length === 0) {
    return { snapshots: [], totals: compute({ revenue: 0, contractor_costs: 0, editing_cost: 0, other_expenses: 0 }) };
  }

  const [{ data: csrs }, { data: exps }] = await Promise.all([
    supabase.from("contractor_service_requests").select("client_id, agreed_total").in("client_id", ids).eq("status", "accepted"),
    supabase.from("wedding_expenses").select("client_id, amount").in("client_id", ids),
  ]);

  const csrMap = new Map<string, number>();
  (csrs ?? []).forEach((r: any) => csrMap.set(r.client_id, (csrMap.get(r.client_id) ?? 0) + Number(r.agreed_total ?? 0)));
  const expMap = new Map<string, number>();
  (exps ?? []).forEach((r: any) => expMap.set(r.client_id, (expMap.get(r.client_id) ?? 0) + Number(r.amount ?? 0)));

  const snapshots = (clients ?? []).map((c: any) => {
    const revenue = Number(c.package_price ?? 0);
    const contractor_costs = csrMap.get(c.id) ?? 0;
    const editing_cost = Number(c.final_image_count ?? 0) * Number(c.editing_rate_per_image ?? 0);
    const other_expenses = expMap.get(c.id) ?? 0;
    return {
      client: { id: c.id, couple_name_1: c.couple_name_1, couple_name_2: c.couple_name_2, wedding_date: c.wedding_date, status: c.status },
      financials: compute({ revenue, contractor_costs, editing_cost, other_expenses }),
    };
  });

  const totals = compute({
    revenue: snapshots.reduce((s, r) => s + r.financials.revenue, 0),
    contractor_costs: snapshots.reduce((s, r) => s + r.financials.contractor_costs, 0),
    editing_cost: snapshots.reduce((s, r) => s + r.financials.editing_cost, 0),
    other_expenses: snapshots.reduce((s, r) => s + r.financials.other_expenses, 0),
  });

  return { snapshots, totals };
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
export function fmtMoneyDecimal(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtMargin(m: number | null): string {
  return m == null ? "—" : `${m.toFixed(1)}%`;
}
