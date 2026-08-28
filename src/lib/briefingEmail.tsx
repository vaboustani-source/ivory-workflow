// Renders briefing HTML email. Pure string templating so the same module
// could be ported to Deno if needed (we keep it TS-only for client-side preview).
import type { BriefingData } from "./briefings";
import { fmtDateRange, fmtMoney } from "./briefings";

const COLORS = {
  bg: "#F6EFE3",        // cream
  surface: "#FFFFFF",
  primary: "#4A1D31",   // wine plum
  accent: "#B41E64",    // brand fuchsia
  gold: "#C9A24A",
  muted: "#7C6A72",
  text: "#2A1A22",
  border: "#E7DCD2",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function clientLink(baseUrl: string, id: string, label: string): string {
  return `<a href="${baseUrl}/studio/clients/${id}" style="color:${COLORS.primary};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

export function renderBriefingEmailHtml(args: {
  data: BriefingData;
  aiSummary: string | null;
  briefingId: string;
  appBaseUrl: string;
}): string {
  const { data, aiSummary, briefingId, appBaseUrl } = args;

  const dateRange = fmtDateRange(data.period.start, data.period.end);

  // This week's weddings
  const weddingsBlock = data.this_week_weddings.length === 0
    ? `<p style="color:${COLORS.muted};font-style:italic;margin:0;">No weddings this week</p>`
    : data.this_week_weddings.map((w) => `
        <div style="padding:12px 0;border-bottom:1px solid ${COLORS.border};">
          <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:${COLORS.primary};font-size:16px;">
            ${clientLink(appBaseUrl, w.id, w.couple_name)}
          </div>
          <div style="color:${COLORS.muted};font-size:13px;margin-top:2px;">
            ${escapeHtml(new Date(w.wedding_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}
            ${w.venue ? ` · ${escapeHtml(w.venue)}` : ""}
          </div>
          <div style="margin-top:6px;font-size:12px;">
            <span style="color:${w.timeline_locked ? "#3F8B5C" : COLORS.accent};">● Timeline ${w.timeline_locked ? "locked" : "not locked"}</span>
            ${w.family_portraits_status ? `<span style="color:${COLORS.muted};margin-left:12px;">● Portraits: ${escapeHtml(w.family_portraits_status)}</span>` : ""}
          </div>
        </div>`).join("");

  // New this week
  const inqList = data.bookings.new_inquiries_couples.map((c) => clientLink(appBaseUrl, c.id, c.name)).join(", ");
  const bookList = data.bookings.new_bookings_couples.map((c) => clientLink(appBaseUrl, c.id, c.name)).join(", ");

  const newSection = `
    <p style="margin:0 0 8px 0;font-size:14px;color:${COLORS.text};">
      <strong>${data.bookings.new_inquiries_count}</strong> new ${data.bookings.new_inquiries_count === 1 ? "inquiry" : "inquiries"}
      ${inqList ? `: ${inqList}` : ""}
    </p>
    <p style="margin:0;font-size:14px;color:${COLORS.text};">
      <strong>${data.bookings.new_bookings_count}</strong> new ${data.bookings.new_bookings_count === 1 ? "booking" : "bookings"}
      ${bookList ? `: ${bookList}` : ""}
    </p>`;

  // Financial pulse 3-col
  const fin = data.financial_pulse;
  const finBlock = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0;">
      <tr>
        ${[
          { l: "Last week revenue", v: fmtMoney(fin.last_week_bookings_revenue) },
          { l: "Pipeline value", v: fmtMoney(fin.pipeline_value) },
          { l: "YTD profit", v: fmtMoney(fin.ytd_profit) },
        ].map((m) => `
          <td width="33%" align="left" style="padding:0 8px 0 0;vertical-align:top;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${COLORS.muted};">${m.l}</div>
            <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:${COLORS.primary};font-size:22px;margin-top:4px;">${m.v}</div>
          </td>`).join("")}
      </tr>
    </table>`;

  // On your plate
  const aq = data.action_queue;
  const plateRows = [
    { n: aq.approval_pending_count, label: "approval queue items", href: `${appBaseUrl}/studio/approval-queue` },
    { n: aq.contracts_pending_photographer_signature, label: "contracts awaiting your signature", href: `${appBaseUrl}/studio/contracts` },
    { n: aq.ai_drafts_to_review, label: "AI drafts to review", href: `${appBaseUrl}/studio/approval-queue` },
  ].filter((r) => r.n > 0);
  const plateBlock = plateRows.length === 0
    ? `<p style="color:${COLORS.muted};font-style:italic;margin:0;">Nothing waiting on you. Nice.</p>`
    : plateRows.map((r) => `
        <p style="margin:0 0 6px 0;font-size:14px;">
          <a href="${r.href}" style="color:${COLORS.primary};text-decoration:none;">
            <strong>${r.n}</strong> ${r.label} →
          </a>
        </p>`).join("");

  // Red flags
  const rf = data.red_flags;
  const flagRows: string[] = [];
  rf.weddings_under_30_days_no_timeline.forEach((w) => {
    flagRows.push(`<p style="margin:0 0 6px 0;font-size:13px;color:${COLORS.text};">⚑ ${clientLink(appBaseUrl, w.id, w.couple_name)} wedding in ${w.days_until} days, no locked timeline</p>`);
  });
  rf.couples_unresponsive_14_days.forEach((c) => {
    flagRows.push(`<p style="margin:0 0 6px 0;font-size:13px;color:${COLORS.text};">⚑ ${clientLink(appBaseUrl, c.id, c.couple_name)} unresponsive ${c.days_since} days</p>`);
  });
  if (rf.contracts_signed_no_payment > 0) {
    flagRows.push(`<p style="margin:0 0 6px 0;font-size:13px;color:${COLORS.text};">⚑ ${rf.contracts_signed_no_payment} contracts signed without payment</p>`);
  }
  const flagBlock = flagRows.length === 0
    ? `<p style="color:${COLORS.muted};font-style:italic;margin:0;">All clear, no flags this week.</p>`
    : flagRows.join("");

  const summaryBlock = aiSummary
    ? `<div style="background:${COLORS.surface};border-left:3px solid ${COLORS.accent};padding:18px 20px;margin-bottom:24px;">
         <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:18px;line-height:1.5;color:${COLORS.primary};">${escapeHtml(aiSummary)}</p>
       </div>`
    : "";

  function section(title: string, body: string): string {
    return `
      <div style="margin-bottom:24px;">
        <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${COLORS.gold};font-weight:600;margin:0 0 12px 0;">${title}</h2>
        <div style="background:${COLORS.surface};padding:18px 20px;border:1px solid ${COLORS.border};">${body}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly Briefing</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:Inter,Helvetica,Arial,sans-serif;color:${COLORS.text};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
        <tr><td style="padding-bottom:24px;text-align:center;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:13px;letter-spacing:4px;text-transform:uppercase;color:${COLORS.primary};">STORIES <em style="font-style:italic;">by</em> VICTORIA</div>
          <div style="height:2px;background:${COLORS.gold};width:60px;margin:14px auto 14px;"></div>
          <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:24px;color:${COLORS.primary};">Weekly Briefing</div>
          <div style="color:${COLORS.muted};font-size:12px;margin-top:4px;">${escapeHtml(dateRange)}</div>
        </td></tr>
        <tr><td>${summaryBlock}</td></tr>
        <tr><td>${section("This week's weddings", weddingsBlock)}</td></tr>
        <tr><td>${section("New this week", newSection)}</td></tr>
        <tr><td>${section("Financial pulse", finBlock)}</td></tr>
        <tr><td>${section("On your plate", plateBlock)}</td></tr>
        <tr><td>${section("Needs attention", flagBlock)}</td></tr>
        <tr><td style="padding:24px 0 8px 0;text-align:center;font-size:12px;color:${COLORS.muted};">
          <p style="margin:0 0 6px 0;"><a href="${appBaseUrl}/studio/briefings/${briefingId}" style="color:${COLORS.primary};">View full briefing in app →</a></p>
          <p style="margin:0;">Reply to this email to leave Dexter a note.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
