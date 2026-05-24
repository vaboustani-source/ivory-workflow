import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { relativeTime } from "@/lib/dates";
import { toast } from "sonner";

type TabKey = "emails" | "pricing";

export const Route = createFileRoute("/studio/approval-queue")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabKey } => ({
    tab: search.tab === "pricing" ? "pricing" : "emails",
  }),
  component: ApprovalQueuePage,
});

function ApprovalQueuePage() {
  const search = useSearch({ from: "/studio/approval-queue" });
  const initialTab: TabKey = search.tab === "pricing" ? "pricing" : "emails";
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <div>
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Approval Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "emails" ? "Drafted emails awaiting your review." : "Manager-proposed pricing changes awaiting your decision."}
          </p>
        </div>
      </header>

      <div className="flex gap-2 border-b border-border mb-6">
        {(["emails", "pricing"] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px transition-colors ${
              tab === t ? "border-gold text-primary" : "border-transparent text-muted-foreground hover:text-primary"
            }`}
          >
            {t === "emails" ? "Emails" : "Pricing changes"}
          </button>
        ))}
      </div>

      {tab === "emails" ? <EmailsPane /> : <PricingPane />}
    </div>
  );
}

// ============================================================
// EMAILS PANE (existing scheduled_communications workflow)
// ============================================================

interface DraftRow {
  id: string;
  client_id: string;
  subject: string | null;
  body_draft: string | null;
  scheduled_send_at: string | null;
  recipient_emails: string[] | null;
  status: string;
  workflow_step_id: string | null;
  client?: { couple_name_1: string; couple_name_2: string | null } | null;
  step?: { title: string | null; stage: string | null } | null;
}

type DateFilter = "all" | "today" | "week" | "older";

function EmailsPane() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [coupleFilter, setCoupleFilter] = useState<string>("all");
  const [sortOldest, setSortOldest] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const ids = await scopeClientIds();
    let q = supabase
      .from("scheduled_communications")
      .select(`
        id, client_id, subject, body_draft, scheduled_send_at, recipient_emails, status, workflow_step_id,
        client:clients(couple_name_1, couple_name_2),
        step:workflow_steps(title, stage)
      `)
      .eq("status", "awaiting_approval")
      .order("scheduled_send_at", { ascending: true, nullsFirst: true })
      .limit(50);
    if (ids !== null) {
      if (ids.length === 0) { setDrafts([]); setLoading(false); return; }
      q = q.in("client_id", ids);
    }
    const { data } = await q;
    setDrafts((data ?? []) as unknown as DraftRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    const channel = supabase.channel("approval-queue-emails")
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_communications" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const couples = useMemo(() => {
    const map = new Map<string, string>();
    drafts.forEach((d) => {
      if (d.client) {
        const name = `${d.client.couple_name_1}${d.client.couple_name_2 ? " & " + d.client.couple_name_2 : ""}`;
        map.set(d.client_id, name);
      }
    });
    return Array.from(map.entries());
  }, [drafts]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    let result = drafts.filter((d) => {
      if (coupleFilter !== "all" && d.client_id !== coupleFilter) return false;
      if (!d.scheduled_send_at && dateFilter !== "all") return false;
      if (d.scheduled_send_at) {
        const t = new Date(d.scheduled_send_at).getTime();
        if (dateFilter === "today" && (t < now - oneDay || t > now + oneDay)) return false;
        if (dateFilter === "week" && (t < now || t > now + 7 * oneDay)) return false;
        if (dateFilter === "older" && t > now) return false;
      }
      return true;
    });
    result = result.sort((a, b) => {
      const ta = a.scheduled_send_at ? new Date(a.scheduled_send_at).getTime() : 0;
      const tb = b.scheduled_send_at ? new Date(b.scheduled_send_at).getTime() : 0;
      return sortOldest ? ta - tb : tb - ta;
    });
    return result;
  }, [drafts, dateFilter, coupleFilter, sortOldest]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1.5">
          {(["all", "today", "week", "older"] as DateFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs capitalize ${
                dateFilter === f ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-primary border border-border"
              }`}
            >
              {f === "week" ? "This week" : f}
            </button>
          ))}
        </div>
        <select value={coupleFilter} onChange={(e) => setCoupleFilter(e.target.value)} className="bg-surface border border-border rounded-sm px-3 py-1.5 text-xs text-foreground">
          <option value="all">All couples</option>
          {couples.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button onClick={() => setSortOldest((s) => !s)} className="text-xs text-muted-foreground hover:text-primary border border-border rounded-sm px-3 py-1.5 bg-surface">
          Sort by {sortOldest ? "oldest" : "newest"}
        </button>
        <span className="ml-auto bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium">
          {drafts.length} pending
        </span>
      </div>

      {loading ? (
        <p className="font-serif italic text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">All caught up. Nothing waiting.</p>
          <p className="text-sm text-muted-foreground mt-2">When the workflow drafts a new email, it'll appear here for your review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              expanded={expanded === d.id}
              onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
              onChanged={load}
              currentUserId={profile?.id ?? null}
            />
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-6 italic text-center">
        Approving marks the email as sent in the system. Real delivery via Resend ships in Phase 6.
      </p>
    </div>
  );
}

function DraftCard({ draft, expanded, onToggle, onChanged, currentUserId }: {
  draft: DraftRow; expanded: boolean; onToggle: () => void; onChanged: () => void; currentUserId: string | null;
}) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body_draft ?? "");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSubject(draft.subject ?? ""); setBody(draft.body_draft ?? ""); }, [draft.id, draft.subject, draft.body_draft]);

  const coupleName = draft.client
    ? `${draft.client.couple_name_1}${draft.client.couple_name_2 ? " & " + draft.client.couple_name_2 : ""}`
    : "Unknown";

  const isPastDue = draft.scheduled_send_at && new Date(draft.scheduled_send_at).getTime() < Date.now();

  const saveDraft = async () => {
    setBusy(true);
    await supabase.from("scheduled_communications").update({ subject, body_draft: body }).eq("id", draft.id);
    setBusy(false);
    toast.success("Draft saved.");
  };

  const approve = async () => {
    setBusy(true);
    await supabase
      .from("scheduled_communications")
      .update({
        subject, body_draft: body,
        status: "sent",
        sent_at: new Date().toISOString(),
        approved_by: currentUserId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    await supabase.from("activity_log").insert({
      user_id: currentUserId,
      action_type: "communication_sent",
      target_type: "scheduled_communication",
      target_id: draft.id,
      description: `Approved & sent: ${subject}`,
      metadata: { client_id: draft.client_id },
    });
    toast.success(`Sent to ${(draft.recipient_emails ?? []).join(", ") || coupleName}.`);
    setBusy(false);
    onChanged();
  };

  const skip = async () => {
    setBusy(true);
    await supabase
      .from("scheduled_communications")
      .update({ status: "skipped" })
      .eq("id", draft.id);
    await supabase.from("activity_log").insert({
      user_id: currentUserId,
      action_type: "communication_skipped",
      target_type: "scheduled_communication",
      target_id: draft.id,
      description: `Skipped: ${draft.subject ?? ""}`,
      metadata: { client_id: draft.client_id, reason: skipReason || null },
    });
    setSkipOpen(false);
    setBusy(false);
    onChanged();
    toast("Skipped.");
  };

  return (
    <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold transition-all">
      <button onClick={onToggle} className="w-full text-left p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <h3 className="font-serif italic text-lg text-primary truncate">{coupleName}</h3>
              <span className={`text-xs shrink-0 ${isPastDue ? "text-magenta" : "text-muted-foreground"}`}>
                {draft.scheduled_send_at ? relativeTime(draft.scheduled_send_at) : "no schedule"}
              </span>
            </div>
            <p className="text-sm text-foreground truncate mb-2">{subject || "(no subject)"}</p>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-wider">
                <span className="text-foreground">{draft.step?.stage?.replace(/_/g, " ") ?? "—"}</span>
                <span className="text-muted-foreground ml-2 normal-case tracking-normal">{draft.step?.title}</span>
              </div>
              {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            To: {(draft.recipient_emails ?? []).join(", ") || "—"}
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm text-foreground"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.max(8, Math.min(24, (body.match(/\n/g)?.length ?? 0) + 4))}
            className="w-full bg-background-alt/40 rounded-sm p-3 text-sm text-foreground font-sans focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground italic">Saving keeps it as a draft. Approving marks it sent.</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSkipOpen(true)} disabled={busy} className="text-sm text-muted-foreground hover:text-magenta px-3 py-2">Skip</button>
              <button onClick={saveDraft} disabled={busy} className="text-sm text-gold border border-gold rounded-md px-4 py-2 hover:bg-gold/10">Save as draft</button>
              <button onClick={approve} disabled={busy} className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90 disabled:opacity-50">Approve & send</button>
            </div>
          </div>
        </div>
      )}

      {skipOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={() => setSkipOpen(false)}>
          <div className="bg-background rounded-lg shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif italic text-xl text-primary">Skip this email?</h3>
            <p className="text-sm text-muted-foreground mt-2">It won't be sent and the milestone moves on. Optional: tell us why.</p>
            <textarea
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              rows={3}
              placeholder="Reason (optional)"
              className="w-full mt-3 bg-surface border border-border rounded-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSkipOpen(false)} className="text-sm text-muted-foreground px-3 py-2">Cancel</button>
              <button onClick={skip} disabled={busy} className="text-sm bg-magenta text-background rounded-md px-4 py-2 hover:opacity-90">Confirm skip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PRICING PANE (new — manager-proposed post-booking changes)
// ============================================================

interface PendingChange {
  id: string;
  client_id: string;
  quote_id: string;
  proposed_by: string;
  proposed_by_role: string;
  change_type: string;
  payload: any;
  before_snapshot: any;
  projected_after: any;
  status: string;
  reason: string | null;
  created_at: string;
}

function PricingPane() {
  const [items, setItems] = useState<PendingChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Record<string, { couple_name_1: string; couple_name_2: string | null }>>({});
  const [proposers, setProposers] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pending_changes")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as PendingChange[];
    setItems(rows);
    const cids = Array.from(new Set(rows.map((r) => r.client_id)));
    const uids = Array.from(new Set(rows.map((r) => r.proposed_by)));
    if (cids.length > 0) {
      const { data: cs } = await supabase.from("clients").select("id,couple_name_1,couple_name_2").in("id", cids);
      const cmap: Record<string, any> = {};
      (cs ?? []).forEach((c: any) => { cmap[c.id] = c; });
      setClients(cmap);
    }
    if (uids.length > 0) {
      const { data: ps } = await supabase.from("profiles").select("id,full_name").in("id", uids);
      const pmap: Record<string, string> = {};
      (ps ?? []).forEach((p: any) => { pmap[p.id] = p.full_name ?? "manager"; });
      setProposers(pmap);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase.channel("approval-queue-pricing")
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_changes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (loading) return <p className="font-serif italic text-muted-foreground">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
        <p className="font-serif italic text-2xl text-primary">No pricing changes waiting.</p>
        <p className="text-sm text-muted-foreground mt-2">When a manager proposes a post-booking change, it'll appear here for your decision.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((p) => (
        <PricingCard
          key={p.id}
          pending={p}
          coupleName={clients[p.client_id] ? `${clients[p.client_id].couple_name_1}${clients[p.client_id].couple_name_2 ? " & " + clients[p.client_id].couple_name_2 : ""}` : "Client"}
          proposerName={proposers[p.proposed_by] ?? "manager"}
          expanded={expanded === p.id}
          onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
          onChanged={load}
        />
      ))}
    </div>
  );
}

function fmt$(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PricingCard({ pending, coupleName, proposerName, expanded, onToggle, onChanged }: {
  pending: PendingChange;
  coupleName: string;
  proposerName: string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [staleData, setStaleData] = useState<any | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const lineTotal: number = pending.payload?.resolved_line_total_cents ?? 0;
  const desc: string = pending.payload?.resolved_description ?? "(item)";

  const approve = async (force: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("approve_pending_change", {
      p_id: pending.id,
      p_force: force,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const res = data as any;
    if (res?.stale && !res?.applied) {
      setStaleData(res);
      return;
    }
    toast.success("Approved and applied.");
    setStaleData(null);
    onChanged();
  };

  const reject = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("reject_pending_change", {
      p_id: pending.id,
      p_note: rejectNote.trim() || undefined,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Rejected.");
    setRejectOpen(false);
    onChanged();
  };

  const projected = (pending.projected_after?.projected_installments ?? []) as any[];

  return (
    <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold">
      <button onClick={onToggle} className="w-full text-left p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <h3 className="font-serif italic text-lg text-primary truncate">{coupleName}</h3>
              <span className="text-[10px] uppercase tracking-wider text-gold border border-gold/40 rounded-sm px-2 py-0.5">
                {pending.change_type.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-sm text-foreground">
              <span className="font-medium">{desc}</span>
              <span className="text-muted-foreground ml-2">{fmt$(lineTotal)}</span>
            </p>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-muted-foreground">
                Proposed by {proposerName} {relativeTime(pending.created_at)}
              </p>
              {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Projected impact on installments</p>
            {projected.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No projection captured.</p>
            ) : (
              <div className="space-y-1.5">
                {projected.map((row: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b border-border/60 pb-1.5">
                    <span className="text-foreground">
                      {row.label ?? (row.created_new ? "New installment" : `Installment #${row.sequence_order ?? i + 1}`)}
                    </span>
                    <span className="text-muted-foreground">
                      {row.old_total_cents != null ? `${fmt$(row.old_total_cents)} → ` : ""}
                      <span className="text-foreground">{fmt$(row.new_total_cents ?? row.total_cents)}</span>
                      <span className="ml-2 text-gold">+{fmt$(row.share_cents ?? row.net_cents)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Quote total: {fmt$(pending.before_snapshot?.quote_total_cents)} → {fmt$(pending.projected_after?.new_quote_total_cents)}
            </p>
          </div>

          {staleData && (
            <div className="rounded-md border border-magenta/50 bg-magenta/10 p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-magenta shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-primary">Financials changed since this was proposed</p>
                <p className="text-xs text-muted-foreground mt-1">
                  At proposal time the quote total was {fmt$(Number(staleData.stored_quote_total ?? 0))}; it's now{" "}
                  {fmt$(Number(staleData.current_quote_total ?? 0))}.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Approving will re-run the math from the CURRENT state (not the stale snapshot).
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setStaleData(null)}
                    disabled={busy}
                    className="text-xs text-muted-foreground px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => approve(true)}
                    disabled={busy}
                    className="text-xs bg-magenta text-background rounded-md px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                  >
                    Approve anyway (re-apply from current state)
                  </button>
                </div>
              </div>
            </div>
          )}

          {!staleData && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setRejectOpen(true)} disabled={busy} className="text-sm text-muted-foreground hover:text-magenta px-3 py-2">
                Reject
              </button>
              <button
                onClick={() => approve(false)}
                disabled={busy}
                className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
              >
                Approve & apply
              </button>
            </div>
          )}
        </div>
      )}

      {rejectOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={() => setRejectOpen(false)}>
          <div className="bg-background rounded-lg shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif italic text-xl text-primary">Reject this change?</h3>
            <p className="text-sm text-muted-foreground mt-2">The manager will be notified. Optional: add a note.</p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Reason (optional)"
              className="w-full mt-3 bg-surface border border-border rounded-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejectOpen(false)} className="text-sm text-muted-foreground px-3 py-2">Cancel</button>
              <button onClick={reject} disabled={busy} className="text-sm bg-magenta text-background rounded-md px-4 py-2 hover:opacity-90">Confirm reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
