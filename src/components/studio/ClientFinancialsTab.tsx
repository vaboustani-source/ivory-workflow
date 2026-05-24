import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { roleLabel } from "@/lib/contractors";
import { shortDate } from "@/lib/dates";
import {
  getClientFinancials,
  fmtMoney,
  fmtMoneyDecimal,
  fmtMargin,
  type FinancialSnapshot,
  type ContractorBreakdownRow,
} from "@/lib/financials";
import { PendingPricingChangesBanner } from "@/components/PendingPricingChangesBanner";

interface Expense { id: string; description: string; category: string; amount: number; expense_date: string | null }

const CATEGORIES = ["travel", "prints", "gifts", "other"] as const;

export function ClientFinancialsTab({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [contractors, setContractors] = useState<ContractorBreakdownRow[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [imageCount, setImageCount] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [showContractors, setShowContractors] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newExp, setNewExp] = useState({ description: "", category: "other", amount: "", expense_date: new Date().toISOString().slice(0, 10) });

  const load = async () => {
    setLoading(true);
    const r = await getClientFinancials(clientId);
    setSnapshot(r.snapshot);
    setContractors(r.contractors);
    setExpenses(r.expenses);
    setImageCount(r.client.final_image_count != null ? String(r.client.final_image_count) : "");
    setRate(r.client.editing_rate_per_image != null ? String(r.client.editing_rate_per_image) : "0.05");
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const saveEditing = async (key: "final_image_count" | "editing_rate_per_image", raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value != null && Number.isNaN(value)) { toast.error("Must be a number"); return; }
    const { error } = await supabase.from("clients").update({ [key]: value } as any).eq("id", clientId);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    load();
  };

  const addExpense = async () => {
    if (!newExp.description.trim() || !newExp.amount.trim()) { toast.error("Description and amount required"); return; }
    const amt = Number(newExp.amount);
    if (Number.isNaN(amt)) { toast.error("Amount must be a number"); return; }
    const { error } = await supabase.from("wedding_expenses").insert({
      client_id: clientId,
      description: newExp.description.trim(),
      category: newExp.category,
      amount: amt,
      expense_date: newExp.expense_date,
    });
    if (error) { toast.error(error.message); return; }
    setAdding(false);
    setNewExp({ description: "", category: "other", amount: "", expense_date: new Date().toISOString().slice(0, 10) });
    load();
  };

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from("wedding_expenses").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading || !snapshot) return <p className="font-serif italic text-primary">Loading…</p>;

  const editingTotal = (Number(imageCount) || 0) * (Number(rate) || 0);

  return (
    <div className="max-w-[640px] space-y-5">
      <PendingPricingChangesBanner clientId={clientId} />
      <div>
        <h2 className="font-serif italic text-[28px] text-primary">Financial summary</h2>
        <p className="text-sm text-muted-foreground mt-1">Live calculation based on contractor fees and recorded expenses.</p>
      </div>

      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold grid grid-cols-4 gap-4">
        <Metric label="Revenue" value={fmtMoney(snapshot.revenue)} />
        <Metric label="Costs" value={fmtMoney(snapshot.total_costs)} />
        <Metric
          label="Profit"
          value={fmtMoney(snapshot.profit)}
          valueClass={snapshot.profit >= 0 ? "text-sage" : "text-magenta"}
        />
        <Metric label="Margin" value={fmtMargin(snapshot.margin)} />
      </div>

      <Card title="Revenue sources">
        <Row label="Investment / Package" value={fmtMoney(snapshot.revenue)} />
        <RowTotal label="Total" value={fmtMoney(snapshot.revenue)} />
      </Card>

      <Card title="Cost breakdown">
        <button onClick={() => setShowContractors((v) => !v)} className="w-full flex justify-between items-center py-2 border-b border-border">
          <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            {showContractors ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Contractor fees
          </span>
          <span className="text-sm text-foreground">{fmtMoney(snapshot.contractor_costs)}</span>
        </button>
        {showContractors && (
          <div className="pl-5 py-2 space-y-1.5">
            {contractors.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No accepted contractor requests.</p>
            ) : contractors.map((c) => (
              <div key={c.id} className="flex justify-between text-xs">
                <span className="text-foreground">{c.contractor_name} <span className="text-muted-foreground">({roleLabel(c.role)})</span></span>
                <span className="text-foreground">{fmtMoney(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <Row label="Editing cost" value={`${fmtMoneyDecimal(snapshot.editing_cost)}`} sub={`${imageCount || 0} images × $${Number(rate || 0).toFixed(2)}/image`} />
        <button onClick={() => setShowExpenses((v) => !v)} className="w-full flex justify-between items-center py-2 border-b border-border">
          <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            {showExpenses ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Other expenses
          </span>
          <span className="text-sm text-foreground">{fmtMoney(snapshot.other_expenses)}</span>
        </button>
        {showExpenses && (
          <div className="pl-5 py-2 space-y-1.5">
            {expenses.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No expenses logged.</p>
            ) : expenses.map((e) => (
              <div key={e.id} className="flex justify-between text-xs">
                <span className="text-foreground">{e.description} <span className="text-muted-foreground">({e.category})</span></span>
                <span className="text-foreground">{fmtMoney(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <RowTotal label="Total" value={fmtMoney(snapshot.total_costs)} />
      </Card>

      <Card title="Editing">
        <div className="flex items-end gap-3 py-2">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">Final image count</label>
            <input
              type="number"
              value={imageCount}
              onChange={(e) => setImageCount(e.target.value)}
              onBlur={() => saveEditing("final_image_count", imageCount)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">$/image</label>
            <input
              type="number"
              step="0.001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              onBlur={() => saveEditing("editing_rate_per_image", rate)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">Total</label>
            <div className="px-3 py-2 bg-background-alt border border-border rounded-md text-sm">{fmtMoneyDecimal(editingTotal)}</div>
          </div>
        </div>
      </Card>

      <Card title="Other expenses">
        {expenses.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground italic py-2">No expenses logged yet.</p>
        )}
        {expenses.map((e) => (
          <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
            <div className="flex-1 text-sm text-foreground">{e.description}</div>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-background-alt rounded-sm text-muted-foreground">{e.category}</span>
            <div className="text-xs text-muted-foreground w-24 text-right">{e.expense_date ? shortDate(e.expense_date) : "—"}</div>
            <div className="text-sm text-foreground w-20 text-right">{fmtMoney(e.amount)}</div>
            <button onClick={() => deleteExpense(e.id)} className="text-muted-foreground hover:text-magenta"><Trash2 size={14} /></button>
          </div>
        ))}
        {adding ? (
          <div className="space-y-2 py-3 border-t border-border">
            <input
              placeholder="Description"
              value={newExp.description}
              onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="grid grid-cols-3 gap-2">
              <select value={newExp.category} onChange={(e) => setNewExp({ ...newExp, category: e.target.value })} className="px-3 py-2 bg-surface border border-border rounded-md text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" placeholder="Amount" value={newExp.amount} onChange={(e) => setNewExp({ ...newExp, amount: e.target.value })} className="px-3 py-2 bg-surface border border-border rounded-md text-sm" />
              <input type="date" value={newExp.expense_date} onChange={(e) => setNewExp({ ...newExp, expense_date: e.target.value })} className="px-3 py-2 bg-surface border border-border rounded-md text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAdding(false); }} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-primary">Cancel</button>
              <button onClick={addExpense} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90">Save</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-3 text-sm text-primary flex items-center gap-1 hover:underline">
            <Plus size={14} /> Add expense
          </button>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`font-serif italic text-2xl text-primary ${valueClass}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border">
      <div>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function RowTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center pt-3 mt-1">
      <span className="text-xs uppercase tracking-wider text-foreground font-medium">{label}</span>
      <span className="text-sm font-medium text-primary">{value}</span>
    </div>
  );
}
