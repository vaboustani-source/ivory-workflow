import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { relativeTime } from "@/lib/dates";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/approval-queue")({
  component: ApprovalQueue,
});

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

function ApprovalQueue() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [coupleFilter, setCoupleFilter] = useState<string>("all");
  const [sortOldest, setSortOldest] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scopedIds, setScopedIds] = useState<string[] | null>(null);

  const load = async () => {
    setLoading(true);
    const ids = await scopeClientIds();
    setScopedIds(ids);
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
      if (ids.length === 0) {
        setDrafts([]);
        setLoading(false);
        return;
      }
      q = q.in("client_id", ids);
    }
    const { data } = await q;
    setDrafts((data ?? []) as unknown as DraftRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("approval-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_communications" },
        () => load(),
      )
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
      <header className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Approval Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Drafted emails awaiting your review.</p>
        </div>
        <span className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium">
          {drafts.length} pending
        </span>
      </header>

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
        {/* PHASE 6 TODO: actual email delivery via Resend not built yet — Approve marks DB only. */}
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
    // PHASE 6 TODO: actually send the email via Resend.
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
      <button
        onClick={onToggle}
        className="w-full text-left p-5"
      >
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
              <button onClick={() => setSkipOpen(true)} disabled={busy} className="text-sm text-muted-foreground hover:text-magenta px-3 py-2">
                Skip
              </button>
              <button onClick={saveDraft} disabled={busy} className="text-sm text-gold border border-gold rounded-md px-4 py-2 hover:bg-gold/10">
                Save as draft
              </button>
              <button onClick={approve} disabled={busy} className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90 disabled:opacity-50">
                Approve & send
              </button>
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
