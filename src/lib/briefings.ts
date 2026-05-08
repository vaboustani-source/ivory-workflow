// Shared types and helpers for Victoria's Weekly Briefings.

export interface BriefingData {
  period: { start: string; end: string };
  bookings: {
    new_inquiries_count: number;
    new_inquiries_couples: { id: string; name: string }[];
    new_bookings_count: number;
    new_bookings_couples: { id: string; name: string }[];
    ytd_bookings_count: number;
    ytd_revenue: number;
  };
  this_week_weddings: {
    id: string;
    couple_name: string;
    wedding_date: string;
    venue: string | null;
    timeline_locked: boolean;
    family_portraits_status: string | null;
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
    weddings_under_30_days_no_timeline: {
      id: string;
      couple_name: string;
      wedding_date: string;
      days_until: number;
    }[];
    couples_unresponsive_14_days: {
      id: string;
      couple_name: string;
      last_contacted_at: string;
      days_since: number;
    }[];
    contracts_signed_no_payment: number;
  };
}

export interface BriefingRow {
  id: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  ai_summary: string | null;
  data: BriefingData;
  email_sent_to: string | null;
  email_sent_at: string | null;
  generated_by: string;
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtDateRange(startISO: string, endISO: string): string {
  const s = new Date(startISO + "T00:00:00Z");
  const e = new Date(endISO + "T00:00:00Z");
  const sM = s.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const eM = e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${sM} – ${eM}`;
}

export function lastFullWeek(): { start: string; end: string } {
  // Last Mon -> Sun (UTC)
  const now = new Date();
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const daysSinceLastSunday = day === 0 ? 7 : day; // last Sunday
  const lastSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceLastSunday));
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);
  return { start: lastMonday.toISOString().slice(0, 10), end: lastSunday.toISOString().slice(0, 10) };
}

export function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetToMon));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}

export function lastMonthRange(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}
