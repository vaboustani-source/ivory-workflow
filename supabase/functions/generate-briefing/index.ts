// Supabase Edge Function: generate-briefing
// Generates Victoria's weekly briefing: collects data, gets AI summary,
// stores row, optionally emails it.
//
// Body:
// {
//   period_start?: "YYYY-MM-DD",  // defaults to last full Mon-Sun
//   period_end?: "YYYY-MM-DD",
//   email_to_me?: boolean,        // default true
//   generated_by?: "cron" | "on_demand", // default "on_demand"
// }
// Response: { briefing_id: string, ai_summary: string, emailed: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CoupleRef { id: string; name: string }
interface BriefingData {
  period: { start: string; end: string };
  bookings: {
    new_inquiries_count: number; new_inquiries_couples: CoupleRef[];
    new_bookings_count: number; new_bookings_couples: CoupleRef[];
    ytd_bookings_count: number; ytd_revenue: number;
  };
  this_week_weddings: {
    id: string; couple_name: string; wedding_date: string; venue: string | null;
    timeline_locked: boolean; family_portraits_status: string | null;
  }[];
  action_queue: {
    approval_pending_count: number;
    contracts_pending_photographer_signature: number;
    ai_drafts_to_review: number;
  };
  financial_pulse: {
    last_week_bookings_revenue: number;
    pipeline_value: number;
    ytd_profit: number;
  };
  red_flags: {
    weddings_under_30_days_no_timeline: { id: string; couple_name: string; wedding_date: string; days_until: number }[];
    couples_unresponsive_14_days: { id: string; couple_name: string; last_contacted_at: string; days_since: number }[];
    contracts_signed_no_payment: number;
  };
}

function coupleName(c: { couple_name_1: string; couple_name_2: string | null }): string {
  return c.couple_name_2 ? `${c.couple_name_1} & ${c.couple_name_2}` : c.couple_name_1;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}

function lastFullWeekUTC(): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceLastSunday = day === 0 ? 7 : day;
  const lastSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceLastSunday));
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);
  return { start: lastMonday.toISOString().slice(0, 10), end: lastSunday.toISOString().slice(0, 10) };
}

function thisWeekUTC(): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetToMon));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}

async function generateBriefingData(supa: any, periodStart: string, periodEnd: string): Promise<BriefingData> {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const yearEnd = `${new Date().getUTCFullYear()}-12-31`;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const startISO = `${periodStart}T00:00:00Z`;
  const endISO = `${periodEnd}T23:59:59Z`;

  // NEW INQUIRIES (status='lead', created in period)
  const { data: inqRows } = await supa
    .from("clients")
    .select("id, couple_name_1, couple_name_2, created_at")
    .eq("status", "lead")
    .gte("created_at", startISO)
    .lte("created_at", endISO);
  const new_inquiries_couples: CoupleRef[] = (inqRows ?? []).map((c: any) => ({ id: c.id, name: coupleName(c) }));

  // NEW BOOKINGS: clients where status='booked' AND booked_at in period (booked_at column from existing trigger)
  const { data: bookRows } = await supa
    .from("clients")
    .select("id, couple_name_1, couple_name_2, package_price, booked_at")
    .eq("status", "booked")
    .gte("booked_at", startISO)
    .lte("booked_at", endISO);
  const new_bookings_couples: CoupleRef[] = (bookRows ?? []).map((c: any) => ({ id: c.id, name: coupleName(c) }));
  const last_week_bookings_revenue = (bookRows ?? []).reduce((s: number, c: any) => s + Number(c.package_price ?? 0), 0);

  // YTD bookings
  const { data: ytdRows } = await supa
    .from("clients")
    .select("id, package_price, booked_at, status")
    .gte("booked_at", `${yearStart}T00:00:00Z`)
    .lte("booked_at", `${yearEnd}T23:59:59Z`);
  const ytd_bookings_count = (ytdRows ?? []).length;
  const ytd_revenue = (ytdRows ?? []).reduce((s: number, c: any) => s + Number(c.package_price ?? 0), 0);

  // THIS WEEK'S WEDDINGS
  const week = thisWeekUTC();
  const { data: weekWeddings } = await supa
    .from("clients")
    .select("id, couple_name_1, couple_name_2, wedding_date, venue_name, status")
    .gte("wedding_date", week.start)
    .lte("wedding_date", week.end)
    .in("status", ["booked", "active"]);
  const weekIds = (weekWeddings ?? []).map((c: any) => c.id);

  let timelinesByClient = new Map<string, boolean>();
  let portraitsByClient = new Map<string, string>();
  if (weekIds.length > 0) {
    const { data: timelines } = await supa
      .from("photography_timelines")
      .select("client_id")
      .in("client_id", weekIds);
    (timelines ?? []).forEach((t: any) => timelinesByClient.set(t.client_id, true));
    const { data: portraits } = await supa
      .from("portrait_sequences")
      .select("client_id, approved_at")
      .in("client_id", weekIds);
    (portraits ?? []).forEach((p: any) => portraitsByClient.set(p.client_id, p.approved_at ? "approved" : "in progress"));
  }
  const this_week_weddings = (weekWeddings ?? []).map((c: any) => ({
    id: c.id,
    couple_name: coupleName(c),
    wedding_date: c.wedding_date,
    venue: c.venue_name ?? null,
    timeline_locked: !!timelinesByClient.get(c.id),
    family_portraits_status: portraitsByClient.get(c.id) ?? null,
  }));

  // ACTION QUEUE
  const { count: approval_pending_count } = await supa
    .from("scheduled_communications")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_approval");

  // Contracts pending photographer signature
  const { data: contractsSent } = await supa
    .from("contracts")
    .select("id, contract_signers!inner(signer_role, signed_at)")
    .eq("status", "sent");
  let contracts_pending_photographer_signature = 0;
  (contractsSent ?? []).forEach((c: any) => {
    const signers = c.contract_signers ?? [];
    const photog = signers.find((s: any) => s.signer_role === "photographer");
    if (photog && !photog.signed_at) contracts_pending_photographer_signature += 1;
  });

  // AI drafts to review: same as approval pending (the auto-drafted ones)
  // Heuristic: scheduled_communications with body_draft starting with [PLACEHOLDER] or auto-generated
  const ai_drafts_to_review = approval_pending_count ?? 0;

  // FINANCIAL: pipeline = booked clients with no signed contract
  const { data: bookedClients } = await supa
    .from("clients")
    .select("id, package_price")
    .eq("status", "booked");
  const bookedIds = (bookedClients ?? []).map((c: any) => c.id);
  let signedClientIds = new Set<string>();
  if (bookedIds.length > 0) {
    const { data: signed } = await supa
      .from("contracts")
      .select("client_id")
      .eq("status", "signed")
      .in("client_id", bookedIds);
    (signed ?? []).forEach((c: any) => c.client_id && signedClientIds.add(c.client_id));
  }
  const pipeline_value = (bookedClients ?? [])
    .filter((c: any) => !signedClientIds.has(c.id))
    .reduce((s: number, c: any) => s + Number(c.package_price ?? 0), 0);

  // YTD profit: revenue (booked clients YTD) minus contractor costs + editing + expenses for those
  const { data: ytdClientsAll } = await supa
    .from("clients")
    .select("id, package_price, final_image_count, editing_rate_per_image, wedding_date")
    .gte("wedding_date", yearStart)
    .lte("wedding_date", yearEnd);
  const ytdIds = (ytdClientsAll ?? []).map((c: any) => c.id);
  let csrCosts = 0, expCosts = 0, editingCosts = 0, revenueYtd = 0;
  (ytdClientsAll ?? []).forEach((c: any) => {
    revenueYtd += Number(c.package_price ?? 0);
    editingCosts += Number(c.final_image_count ?? 0) * Number(c.editing_rate_per_image ?? 0);
  });
  if (ytdIds.length > 0) {
    const [{ data: csrs }, { data: exps }] = await Promise.all([
      supa.from("contractor_service_requests").select("agreed_total").in("client_id", ytdIds).eq("status", "accepted"),
      supa.from("wedding_expenses").select("amount").in("client_id", ytdIds),
    ]);
    csrCosts = (csrs ?? []).reduce((s: number, r: any) => s + Number(r.agreed_total ?? 0), 0);
    expCosts = (exps ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  }
  const ytd_profit = revenueYtd - csrCosts - editingCosts - expCosts;

  // RED FLAGS
  const { data: noTimeline } = await supa
    .from("clients")
    .select("id, couple_name_1, couple_name_2, wedding_date")
    .gte("wedding_date", today)
    .lte("wedding_date", thirtyDaysOut)
    .in("status", ["booked", "active"]);
  let weddings_under_30_days_no_timeline: BriefingData["red_flags"]["weddings_under_30_days_no_timeline"] = [];
  if ((noTimeline ?? []).length > 0) {
    const ids = noTimeline!.map((c: any) => c.id);
    const { data: tlns } = await supa.from("photography_timelines").select("client_id").in("client_id", ids);
    const have = new Set((tlns ?? []).map((t: any) => t.client_id));
    weddings_under_30_days_no_timeline = noTimeline!
      .filter((c: any) => !have.has(c.id))
      .map((c: any) => ({
        id: c.id,
        couple_name: coupleName(c),
        wedding_date: c.wedding_date,
        days_until: daysBetween(today, c.wedding_date),
      }));
  }

  const { data: stale } = await supa
    .from("clients")
    .select("id, couple_name_1, couple_name_2, last_contacted_at")
    .in("status", ["lead", "booked", "active"])
    .not("last_contacted_at", "is", null)
    .lt("last_contacted_at", fourteenDaysAgo);
  const couples_unresponsive_14_days = (stale ?? []).map((c: any) => ({
    id: c.id,
    couple_name: coupleName(c),
    last_contacted_at: c.last_contacted_at,
    days_since: daysBetween(c.last_contacted_at.slice(0, 10), today),
  }));

  return {
    period: { start: periodStart, end: periodEnd },
    bookings: {
      new_inquiries_count: new_inquiries_couples.length,
      new_inquiries_couples,
      new_bookings_count: new_bookings_couples.length,
      new_bookings_couples,
      ytd_bookings_count,
      ytd_revenue,
    },
    this_week_weddings,
    action_queue: {
      approval_pending_count: approval_pending_count ?? 0,
      contracts_pending_photographer_signature,
      ai_drafts_to_review,
    },
    financial_pulse: {
      last_week_bookings_revenue,
      pipeline_value,
      ytd_profit,
    },
    red_flags: {
      weddings_under_30_days_no_timeline,
      couples_unresponsive_14_days,
      contracts_signed_no_payment: 0,
    },
  };
}

const SUMMARY_SYSTEM = `You are writing a brief 1-2 sentence summary for Victoria's weekly studio briefing. Voice: warm, conversational, factual. Like a status note from her studio manager Dexter. Lead with the most important insight, not just metrics.

Examples:
- "Quieter week than last, only 2 new inquiries, but both are strong fits for spring 2027. The Reyes wedding is now inside 30 days and we still don't have a locked timeline."
- "Big week: 3 new bookings, all premium tier. Pipeline value jumped 35%. Need your sign-off on the photographer signature for Marlowe contract."
- "Steady week. Numbers tracking with last quarter average. No urgent action items."

Be specific. Use real names. Avoid generic management speak. NO em-dashes or en-dashes. Two sentences max. Output only the summary text.`;

async function generateAISummary(data: BriefingData): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 250,
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(data) }],
      }),
    });
    if (!res.ok) {
      console.error("Claude error", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    const text = j?.content?.[0]?.text;
    return typeof text === "string" ? text.trim().replace(/[—–]/g, ",") : null;
  } catch (e) {
    console.error("claude failed", e);
    return null;
  }
}

const BRIEFING_EMAIL_COLORS = {
  bg: "#FBF6EE", surface: "#FFFFFF", primary: "#5B0E1A", accent: "#C73E5C",
  gold: "#C9A24A", muted: "#8A7E72", text: "#2A1E1A", border: "#E8DDC9",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function fmtMoney(n: number): string { return `$${Math.round(n).toLocaleString()}`; }
function fmtRange(s: string, e: string): string {
  const a = new Date(s + "T00:00:00Z"), b = new Date(e + "T00:00:00Z");
  return `${a.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${b.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

function renderEmail(data: BriefingData, summary: string | null, briefingId: string, base: string): string {
  const C = BRIEFING_EMAIL_COLORS;
  const link = (id: string, label: string) => `<a href="${base}/studio/clients/${id}" style="color:${C.primary};">${escapeHtml(label)}</a>`;

  const weddings = data.this_week_weddings.length === 0
    ? `<p style="color:${C.muted};font-style:italic;margin:0;">No weddings this week</p>`
    : data.this_week_weddings.map(w => `
        <div style="padding:12px 0;border-bottom:1px solid ${C.border};">
          <div style="font-family:Georgia,serif;font-style:italic;color:${C.primary};font-size:16px;">${link(w.id, w.couple_name)}</div>
          <div style="color:${C.muted};font-size:13px;margin-top:2px;">${escapeHtml(new Date(w.wedding_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}${w.venue ? " · " + escapeHtml(w.venue) : ""}</div>
          <div style="margin-top:6px;font-size:12px;"><span style="color:${w.timeline_locked ? "#3F8B5C" : C.accent};">● Timeline ${w.timeline_locked ? "locked" : "not locked"}</span>${w.family_portraits_status ? `<span style="color:${C.muted};margin-left:12px;">● Portraits: ${escapeHtml(w.family_portraits_status)}</span>` : ""}</div>
        </div>`).join("");

  const inqList = data.bookings.new_inquiries_couples.map(c => link(c.id, c.name)).join(", ");
  const bookList = data.bookings.new_bookings_couples.map(c => link(c.id, c.name)).join(", ");
  const newSec = `
    <p style="margin:0 0 8px 0;font-size:14px;"><strong>${data.bookings.new_inquiries_count}</strong> new ${data.bookings.new_inquiries_count === 1 ? "inquiry" : "inquiries"}${inqList ? ": " + inqList : ""}</p>
    <p style="margin:0;font-size:14px;"><strong>${data.bookings.new_bookings_count}</strong> new ${data.bookings.new_bookings_count === 1 ? "booking" : "bookings"}${bookList ? ": " + bookList : ""}</p>`;

  const finRow = (l: string, v: string) => `<td width="33%" style="padding:0 8px 0 0;vertical-align:top;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${C.muted};">${l}</div><div style="font-family:Georgia,serif;font-style:italic;color:${C.primary};font-size:22px;margin-top:4px;">${v}</div></td>`;
  const finBlock = `<table width="100%" cellpadding="0" cellspacing="0"><tr>${finRow("Last week revenue", fmtMoney(data.financial_pulse.last_week_bookings_revenue))}${finRow("Pipeline value", fmtMoney(data.financial_pulse.pipeline_value))}${finRow("YTD profit", fmtMoney(data.financial_pulse.ytd_profit))}</tr></table>`;

  const aq = data.action_queue;
  const plate = [
    { n: aq.approval_pending_count, label: "approval queue items", href: `${base}/studio/approval-queue` },
    { n: aq.contracts_pending_photographer_signature, label: "contracts awaiting your signature", href: `${base}/studio/contracts` },
    { n: aq.ai_drafts_to_review, label: "AI drafts to review", href: `${base}/studio/approval-queue` },
  ].filter(r => r.n > 0);
  const plateBlock = plate.length === 0
    ? `<p style="color:${C.muted};font-style:italic;margin:0;">Nothing waiting on you. Nice.</p>`
    : plate.map(r => `<p style="margin:0 0 6px 0;font-size:14px;"><a href="${r.href}" style="color:${C.primary};text-decoration:none;"><strong>${r.n}</strong> ${r.label} →</a></p>`).join("");

  const rf = data.red_flags;
  const flags: string[] = [];
  rf.weddings_under_30_days_no_timeline.forEach(w => flags.push(`<p style="margin:0 0 6px 0;font-size:13px;">⚑ ${link(w.id, w.couple_name)} wedding in ${w.days_until} days, no locked timeline</p>`));
  rf.couples_unresponsive_14_days.forEach(c => flags.push(`<p style="margin:0 0 6px 0;font-size:13px;">⚑ ${link(c.id, c.couple_name)} unresponsive ${c.days_since} days</p>`));
  if (rf.contracts_signed_no_payment > 0) flags.push(`<p style="margin:0 0 6px 0;font-size:13px;">⚑ ${rf.contracts_signed_no_payment} contracts signed without payment</p>`);
  const flagBlock = flags.length === 0 ? `<p style="color:${C.muted};font-style:italic;margin:0;">All clear, no flags this week.</p>` : flags.join("");

  const sumBlock = summary ? `<div style="background:${C.surface};border-left:3px solid ${C.accent};padding:18px 20px;margin-bottom:24px;"><p style="margin:0;font-family:Georgia,serif;font-style:italic;font-size:18px;line-height:1.5;color:${C.primary};">${escapeHtml(summary)}</p></div>` : "";
  const section = (t: string, body: string) => `<div style="margin-bottom:24px;"><h2 style="font-family:Georgia,serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};font-weight:600;margin:0 0 12px 0;">${t}</h2><div style="background:${C.surface};padding:18px 20px;border:1px solid ${C.border};">${body}</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${C.bg};font-family:Helvetica,Arial,sans-serif;color:${C.text};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
<tr><td style="padding-bottom:24px;text-align:center;">
<div style="font-family:Georgia,serif;font-size:13px;letter-spacing:4px;text-transform:uppercase;color:${C.primary};">STORIES <em>by</em> VICTORIA</div>
<div style="height:2px;background:${C.gold};width:60px;margin:14px auto;"></div>
<div style="font-family:Georgia,serif;font-style:italic;font-size:24px;color:${C.primary};">Weekly Briefing</div>
<div style="color:${C.muted};font-size:12px;margin-top:4px;">${escapeHtml(fmtRange(data.period.start, data.period.end))}</div>
</td></tr>
<tr><td>${sumBlock}</td></tr>
<tr><td>${section("This week's weddings", weddings)}</td></tr>
<tr><td>${section("New this week", newSec)}</td></tr>
<tr><td>${section("Financial pulse", finBlock)}</td></tr>
<tr><td>${section("On your plate", plateBlock)}</td></tr>
<tr><td>${section("Needs attention", flagBlock)}</td></tr>
<tr><td style="padding:24px 0 8px 0;text-align:center;font-size:12px;color:${C.muted};">
<p style="margin:0 0 6px 0;"><a href="${base}/studio/briefings/${briefingId}" style="color:${C.primary};">View full briefing in app →</a></p>
<p style="margin:0;">Reply to this email to leave Dexter a note.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.warn("no RESEND_API_KEY");
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Stories by Victoria <hello@storiesbyvictoria.com>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      console.error("resend error", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("resend threw", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const defaultRange = lastFullWeekUTC();
    const period_start = body.period_start ?? defaultRange.start;
    const period_end = body.period_end ?? defaultRange.end;
    const email_to_me = body.email_to_me !== false;
    const generated_by = body.generated_by ?? "on_demand";

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const data = await generateBriefingData(supa, period_start, period_end);
    const ai_summary = await generateAISummary(data);

    const { data: inserted, error: insErr } = await supa
      .from("briefings")
      .insert({ period_start, period_end, data, ai_summary, generated_by })
      .select("id")
      .single();
    if (insErr) throw new Error(`insert briefing: ${insErr.message}`);
    const briefingId = inserted!.id;

    let emailed = false;
    if (email_to_me) {
      // Find recipient: studio_settings.studio_email if set, else owner profile email
      const { data: settings } = await supa.from("studio_settings").select("studio_email").eq("is_active", true).maybeSingle();
      let to = settings?.studio_email ?? null;
      if (!to) {
        const { data: owner } = await supa.from("profiles").select("email").eq("role", "owner").limit(1).maybeSingle();
        to = owner?.email ?? null;
      }
      if (to) {
        const appBase = Deno.env.get("APP_BASE_URL") ?? "https://id-preview--e3bb35b0-f740-4259-80fa-567ec5c67321.lovable.app";
        const html = renderEmail(data, ai_summary, briefingId, appBase);
        const subject = `Weekly Briefing · ${fmtRange(period_start, period_end)}`;
        const ok = await sendEmail(to, subject, html);
        if (ok) {
          emailed = true;
          await supa.from("briefings").update({ email_sent_at: new Date().toISOString(), email_sent_to: to }).eq("id", briefingId);
        }
      }
    }

    return new Response(JSON.stringify({ briefing_id: briefingId, ai_summary, emailed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-briefing error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
