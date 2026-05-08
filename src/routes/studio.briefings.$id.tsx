import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateRange, fmtMoney, type BriefingRow, type BriefingData } from "@/lib/briefings";

export const Route = createFileRoute("/studio/briefings/$id")({
  component: BriefingDetailPage,
});

function BriefingDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState<BriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    supabase.from("briefings").select("*").eq("id", id).maybeSingle().then(({ data }) => {
      setRow(data as any);
      setLoading(false);
    });
  }, [id]);

  const resend = async () => {
    if (!row) return;
    setResending(true);
    setResent(false);
    try {
      const { error } = await supabase.functions.invoke("generate-briefing", {
        body: {
          period_start: row.period_start,
          period_end: row.period_end,
          email_to_me: true,
          generated_by: "on_demand",
        },
      });
      if (!error) setResent(true);
    } finally {
      setResending(false);
    }
  };

  if (loading) return <p className="font-serif italic text-primary">Loading…</p>;
  if (!row) return <p className="font-serif italic text-magenta">Briefing not found.</p>;

  const d = row.data as BriefingData;

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate({ to: "/studio/briefings" })} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={14} /> All briefings
      </button>

      <div className="text-center mb-6">
        <div className="text-[11px] tracking-[0.3em] uppercase text-primary">STORIES <em>by</em> VICTORIA</div>
        <div className="h-0.5 w-14 bg-gold mx-auto my-3" />
        <h1 className="font-serif italic text-3xl text-primary">Weekly Briefing</h1>
        <p className="text-sm text-muted-foreground mt-1">{fmtDateRange(d.period.start, d.period.end)}</p>
      </div>

      {row.ai_summary && (
        <div className="bg-surface border-l-[3px] border-magenta px-5 py-4 mb-6">
          <p className="font-serif italic text-lg leading-relaxed text-primary">{row.ai_summary}</p>
        </div>
      )}

      <Section title="This week's weddings">
        {d.this_week_weddings.length === 0 ? (
          <Empty>No weddings this week</Empty>
        ) : (
          d.this_week_weddings.map((w) => (
            <div key={w.id} className="py-3 border-b border-border last:border-0">
              <Link to="/studio/clients/$id" params={{ id: w.id }} className="font-serif italic text-base text-primary">{w.couple_name}</Link>
              <div className="text-sm text-muted-foreground mt-0.5">
                {new Date(w.wedding_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                {w.venue ? ` · ${w.venue}` : ""}
              </div>
              <div className="flex gap-4 text-xs mt-1.5">
                <span className={w.timeline_locked ? "text-sage" : "text-magenta"}>● Timeline {w.timeline_locked ? "locked" : "not locked"}</span>
                {w.family_portraits_status && <span className="text-muted-foreground">● Portraits: {w.family_portraits_status}</span>}
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title="New this week">
        <p className="text-sm mb-2"><strong>{d.bookings.new_inquiries_count}</strong> new {d.bookings.new_inquiries_count === 1 ? "inquiry" : "inquiries"}{d.bookings.new_inquiries_couples.length > 0 && ": "}
          {d.bookings.new_inquiries_couples.map((c, i) => (
            <span key={c.id}>{i > 0 && ", "}<Link to="/studio/clients/$id" params={{ id: c.id }} className="text-primary underline">{c.name}</Link></span>
          ))}
        </p>
        <p className="text-sm"><strong>{d.bookings.new_bookings_count}</strong> new {d.bookings.new_bookings_count === 1 ? "booking" : "bookings"}{d.bookings.new_bookings_couples.length > 0 && ": "}
          {d.bookings.new_bookings_couples.map((c, i) => (
            <span key={c.id}>{i > 0 && ", "}<Link to="/studio/clients/$id" params={{ id: c.id }} className="text-primary underline">{c.name}</Link></span>
          ))}
        </p>
      </Section>

      <Section title="Financial pulse">
        <div className="grid grid-cols-3 gap-4">
          <Metric label="Last week revenue" value={fmtMoney(d.financial_pulse.last_week_bookings_revenue)} />
          <Metric label="Pipeline value" value={fmtMoney(d.financial_pulse.pipeline_value)} />
          <Metric label="YTD profit" value={fmtMoney(d.financial_pulse.ytd_profit)} />
        </div>
      </Section>

      <Section title="On your plate">
        {(() => {
          const aq = d.action_queue;
          const items = [
            { n: aq.approval_pending_count, label: "approval queue items", to: "/studio/approval-queue" },
            { n: aq.contracts_pending_photographer_signature, label: "contracts awaiting your signature", to: "/studio/contracts" },
            { n: aq.ai_drafts_to_review, label: "AI drafts to review", to: "/studio/approval-queue" },
          ].filter((r) => r.n > 0);
          if (items.length === 0) return <Empty>Nothing waiting on you. Nice.</Empty>;
          return items.map((it) => (
            <p key={it.label} className="text-sm py-1"><a href={it.to} className="text-primary"><strong>{it.n}</strong> {it.label} →</a></p>
          ));
        })()}
      </Section>

      <Section title="Needs attention">
        {(() => {
          const rf = d.red_flags;
          const flags: React.ReactNode[] = [];
          rf.weddings_under_30_days_no_timeline.forEach((w) => flags.push(
            <p key={"t-" + w.id} className="text-sm py-1 flex items-start gap-2"><AlertCircle size={14} className="text-magenta mt-0.5" /><span><Link to="/studio/clients/$id" params={{ id: w.id }} className="text-primary underline">{w.couple_name}</Link> wedding in {w.days_until} days, no locked timeline</span></p>
          ));
          rf.couples_unresponsive_14_days.forEach((c) => flags.push(
            <p key={"u-" + c.id} className="text-sm py-1 flex items-start gap-2"><AlertCircle size={14} className="text-magenta mt-0.5" /><span><Link to="/studio/clients/$id" params={{ id: c.id }} className="text-primary underline">{c.couple_name}</Link> unresponsive {c.days_since} days</span></p>
          ));
          if (rf.contracts_signed_no_payment > 0) flags.push(
            <p key="cnp" className="text-sm py-1 flex items-start gap-2"><AlertCircle size={14} className="text-magenta mt-0.5" /><span>{rf.contracts_signed_no_payment} contracts signed without payment</span></p>
          );
          if (flags.length === 0) return <Empty>All clear, no flags this week.</Empty>;
          return flags;
        })()}
      </Section>

      <div className="text-center pt-4 pb-12">
        <button onClick={resend} disabled={resending} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-background rounded-sm text-sm hover:opacity-90 disabled:opacity-60">
          {resent ? <CheckCircle2 size={14} /> : <Mail size={14} />}
          {resent ? "Email sent" : resending ? "Sending…" : "Email this to me"}
        </button>
        {row.email_sent_at && (
          <p className="text-xs text-muted-foreground mt-2">Last emailed {new Date(row.email_sent_at).toLocaleString()} to {row.email_sent_to}</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="font-serif text-[12px] tracking-[2px] uppercase text-gold mb-3">{title}</h2>
      <div className="bg-surface border border-border p-5 rounded-sm">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground italic text-sm m-0">{children}</p>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-serif italic text-2xl text-primary mt-1">{value}</div>
    </div>
  );
}
