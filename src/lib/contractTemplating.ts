// Placeholder resolution for contract templates.
// Templates store HTML with literal {placeholder} tokens. At send time we
// resolve them against the relevant client / contractor / service request /
// studio context. Unknown placeholders are wrapped in a subtle gray span so
// reviewers can spot them.

import { roleLabel } from "@/lib/contractors";

export type PlaceholderCategory = "couple" | "contractor" | "studio";

export interface PlaceholderDef {
  key: string;             // e.g., "contractor_name"
  token: string;           // e.g., "{contractor_name}"
  label: string;           // pill display
  description: string;
  category: PlaceholderCategory;
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  // Couple / client
  { key: "couple_name_1", token: "{couple_name_1}", label: "Partner 1 name", description: "First partner's first name", category: "couple" },
  { key: "couple_name_2", token: "{couple_name_2}", label: "Partner 2 name", description: "Second partner's first name", category: "couple" },
  { key: "couple_full_names", token: "{couple_full_names}", label: "Couple full names", description: "e.g., Sophia & Ethan", category: "couple" },
  { key: "wedding_date", token: "{wedding_date}", label: "Wedding date (long)", description: "Saturday, February 24, 2027", category: "couple" },
  { key: "wedding_date_short", token: "{wedding_date_short}", label: "Wedding date (short)", description: "2/24/27", category: "couple" },
  { key: "ceremony_address", token: "{ceremony_address}", label: "Ceremony address", description: "Full venue address", category: "couple" },
  { key: "venue_name", token: "{venue_name}", label: "Venue name", description: "Venue display name", category: "couple" },
  { key: "ceremony_time", token: "{ceremony_time}", label: "Ceremony time", description: "From photography timeline", category: "couple" },
  { key: "coverage_window_start", token: "{coverage_window_start}", label: "Coverage start", description: "From photography timeline", category: "couple" },
  { key: "coverage_window_end", token: "{coverage_window_end}", label: "Coverage end", description: "From photography timeline", category: "couple" },
  { key: "primary_email", token: "{primary_email}", label: "Primary email", description: "Couple's primary email", category: "couple" },
  { key: "secondary_email", token: "{secondary_email}", label: "Secondary email", description: "Couple's secondary email", category: "couple" },

  // Primary client (contract terminology)
  { key: "primary_client_first_name", token: "{primary_client_first_name}", label: "Primary client first name", description: "Primary client first name", category: "couple" },
  { key: "primary_client_last_name", token: "{primary_client_last_name}", label: "Primary client last name", description: "Primary client last name", category: "couple" },
  { key: "primary_client_full_name", token: "{primary_client_full_name}", label: "Primary client full name", description: "Primary client full name (first + last)", category: "couple" },
  { key: "primary_client_phone", token: "{primary_client_phone}", label: "Primary client phone", description: "Primary client phone", category: "couple" },

  // Alternate client (contract terminology)
  { key: "alternate_client_first_name", token: "{alternate_client_first_name}", label: "Alternate client first name", description: "Alternate client first name", category: "couple" },
  { key: "alternate_client_last_name", token: "{alternate_client_last_name}", label: "Alternate client last name", description: "Alternate client last name", category: "couple" },
  { key: "alternate_client_full_name", token: "{alternate_client_full_name}", label: "Alternate client full name", description: "Alternate client full name (first + last)", category: "couple" },
  { key: "alternate_client_phone", token: "{alternate_client_phone}", label: "Alternate client phone", description: "Alternate client phone", category: "couple" },

  // Shared address
  { key: "shared_street_address", token: "{shared_street_address}", label: "Shared street", description: "Couple shared street address", category: "couple" },
  { key: "shared_city", token: "{shared_city}", label: "Shared city", description: "Couple shared city", category: "couple" },
  { key: "shared_state", token: "{shared_state}", label: "Shared state", description: "Couple shared state", category: "couple" },
  { key: "shared_zipcode", token: "{shared_zipcode}", label: "Shared ZIP", description: "Couple shared ZIP code", category: "couple" },
  { key: "shared_full_address", token: "{shared_full_address}", label: "Shared full address", description: "Couple shared full address (assembled)", category: "couple" },

  // Contractor (only relevant for contractor templates)
  { key: "contractor_name", token: "{contractor_name}", label: "Contractor full name", description: "Contractor's full name", category: "contractor" },
  { key: "contractor_first_name", token: "{contractor_first_name}", label: "Contractor first name", description: "First word of contractor name", category: "contractor" },
  { key: "contractor_role", token: "{contractor_role}", label: "Contractor role", description: 'e.g., "Second Shooter"', category: "contractor" },
  { key: "hourly_rate", token: "{hourly_rate}", label: "Hourly rate", description: "e.g., $75/hr", category: "contractor" },
  { key: "agreed_hours", token: "{agreed_hours}", label: "Agreed hours", description: "e.g., 8 hours", category: "contractor" },
  { key: "total_compensation", token: "{total_compensation}", label: "Total compensation", description: "e.g., $600", category: "contractor" },

  // Studio
  { key: "studio_name", token: "{studio_name}", label: "Studio name", description: '"Stories by Victoria"', category: "studio" },
  { key: "photographer_name", token: "{photographer_name}", label: "Photographer name", description: "Lead photographer name from studio settings", category: "studio" },
  { key: "photographer_company", token: "{photographer_company}", label: "Photographer company", description: "Studio company name", category: "studio" },
  { key: "studio_email", token: "{studio_email}", label: "Studio email", description: "Studio primary email", category: "studio" },
  { key: "studio_phone", token: "{studio_phone}", label: "Studio phone", description: "Studio phone number", category: "studio" },
  { key: "studio_address", token: "{studio_address}", label: "Studio address", description: "Studio physical business address", category: "studio" },
  { key: "studio_mailing_address", token: "{studio_mailing_address}", label: "Studio mailing address", description: "Studio mailing address (if different)", category: "studio" },
  { key: "ein", token: "{ein}", label: "EIN / Tax ID", description: "Studio EIN / tax ID", category: "studio" },
  { key: "instagram", token: "{instagram}", label: "Instagram", description: "Studio Instagram handle", category: "studio" },
  { key: "website", token: "{website}", label: "Website", description: "Studio website URL", category: "studio" },
  { key: "overage_hourly_rate", token: "{overage_hourly_rate}", label: "Overage hourly rate", description: "Hourly rate for additional coverage time", category: "studio" },
  { key: "video_cancellation_fee", token: "{video_cancellation_fee}", label: "Video cancellation fee", description: "Video cancellation fee", category: "studio" },
  { key: "album_credit_expiry_months", token: "{album_credit_expiry_months}", label: "Album credit expiry", description: "Album credit expiry in months", category: "studio" },
  { key: "rescheduling_fee_pct", token: "{rescheduling_fee_pct}", label: "Rescheduling fee", description: "Rescheduling fee percentage", category: "studio" },
  { key: "sbv_signer_name", token: "{sbv_signer_name}", label: "Signer name", description: "Whoever's sending", category: "studio" },
  { key: "today_date", token: "{today_date}", label: "Today's date", description: "Today's date (long)", category: "studio" },
  { key: "today_year", token: "{today_year}", label: "Current year", description: "e.g., 2026", category: "studio" },
];

export const PLACEHOLDER_KEYS = new Set(PLACEHOLDERS.map((p) => p.key));

export interface TemplatingContext {
  client?: {
    couple_name_1?: string | null;
    couple_name_2?: string | null;
    wedding_date?: string | null;
    venue_name?: string | null;
    venue_address?: string | null;
    venue_street?: string | null;
    venue_city?: string | null;
    venue_state?: string | null;
    venue_postal_code?: string | null;
    primary_email?: string | null;
    secondary_email?: string | null;
    primary_client_last_name?: string | null;
    alternate_client_last_name?: string | null;
    primary_client_phone?: string | null;
    alternate_client_phone?: string | null;
    shared_street_address?: string | null;
    shared_city?: string | null;
    shared_state?: string | null;
    shared_zipcode?: string | null;
  };
  contractor?: {
    full_name?: string | null;
    email?: string | null;
  };
  serviceRequest?: {
    role?: string | null;
    agreed_hourly_rate?: number | null;
    agreed_hours?: number | null;
    agreed_total?: number | null;
  };
  timeline?: {
    ceremony_start_time?: string | null;
    coverage_end_time?: string | null;
  };
  studio?: {
    name?: string;
    photographer_name?: string;
    photographer_company?: string;
    studio_email?: string;
    studio_phone?: string;
    studio_address?: string;
    studio_mailing_address?: string;
    ein?: string;
    instagram?: string;
    website?: string;
    overage_hourly_rate?: number;
    video_cancellation_fee?: number;
    album_credit_expiry_months?: number;
    rescheduling_fee_pct?: number;
    signer_name?: string | null;
  };
}

function fmtDateLong(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch { return ""; }
}
function fmtDateShort(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("en-US", { year: "2-digit", month: "numeric", day: "numeric" });
  } catch { return ""; }
}
function fmtTime(t?: string | null): string {
  if (!t) return "";
  // expected "HH:MM:SS" or "HH:MM"
  const [hh, mm] = t.split(":");
  let h = Number(hh); const m = mm ?? "00";
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

export function buildContextValues(ctx: TemplatingContext): Record<string, string> {
  const c = ctx.client ?? {};
  const co = ctx.contractor ?? {};
  const sr = ctx.serviceRequest ?? {};
  const tl = ctx.timeline ?? {};
  const studio = ctx.studio ?? {};

  const fullNames = [c.couple_name_1, c.couple_name_2].filter(Boolean).join(" & ");
  const ceremonyAddress = [c.venue_street, c.venue_city, c.venue_state, c.venue_postal_code].filter(Boolean).join(", ")
    || c.venue_address || "";

  const today = new Date();
  const v: Record<string, string> = {
    couple_name_1: c.couple_name_1 ?? "",
    couple_name_2: c.couple_name_2 ?? "",
    couple_full_names: fullNames,
    wedding_date: fmtDateLong(c.wedding_date),
    wedding_date_short: fmtDateShort(c.wedding_date),
    ceremony_address: ceremonyAddress,
    venue_name: c.venue_name ?? "",
    ceremony_time: fmtTime(tl.ceremony_start_time),
    coverage_window_start: fmtTime(tl.ceremony_start_time),
    coverage_window_end: fmtTime(tl.coverage_end_time),
    primary_email: c.primary_email ?? "",
    secondary_email: c.secondary_email ?? "",

    primary_client_first_name: c.couple_name_1 ?? "",
    primary_client_last_name: c.primary_client_last_name ?? "",
    primary_client_full_name: [c.couple_name_1, c.primary_client_last_name].filter(Boolean).join(" "),
    primary_client_phone: c.primary_client_phone ?? "",
    alternate_client_first_name: c.couple_name_2 ?? "",
    alternate_client_last_name: c.alternate_client_last_name ?? "",
    alternate_client_full_name: [c.couple_name_2, c.alternate_client_last_name].filter(Boolean).join(" "),
    alternate_client_phone: c.alternate_client_phone ?? "",
    shared_street_address: c.shared_street_address ?? "",
    shared_city: c.shared_city ?? "",
    shared_state: c.shared_state ?? "",
    shared_zipcode: c.shared_zipcode ?? "",
    shared_full_address: [
      c.shared_street_address,
      [c.shared_city, c.shared_state, c.shared_zipcode].filter(Boolean).join(", "),
    ].filter(Boolean).join("\n"),

    contractor_name: co.full_name ?? "",
    contractor_first_name: (co.full_name ?? "").split(" ")[0] ?? "",
    contractor_role: roleLabel(sr.role ?? null),
    hourly_rate: sr.agreed_hourly_rate != null ? `$${sr.agreed_hourly_rate}/hr` : "",
    agreed_hours: sr.agreed_hours != null ? `${sr.agreed_hours} hours` : "",
    total_compensation: sr.agreed_total != null ? `$${sr.agreed_total}` : "",

    studio_name: studio.name ?? "Stories by Victoria",
    photographer_name: studio.photographer_name ?? "",
    photographer_company: studio.photographer_company ?? "Stories by Victoria",
    studio_email: studio.studio_email ?? "",
    studio_phone: studio.studio_phone ?? "",
    studio_address: studio.studio_address ?? "",
    studio_mailing_address: studio.studio_mailing_address ?? "",
    ein: studio.ein ?? "",
    instagram: studio.instagram
      ? (studio.instagram.startsWith("@") ? studio.instagram : "@" + studio.instagram)
      : "",
    website: studio.website ?? "",
    overage_hourly_rate: studio.overage_hourly_rate != null ? `$${studio.overage_hourly_rate}/hr` : "",
    video_cancellation_fee: studio.video_cancellation_fee != null ? `$${studio.video_cancellation_fee.toLocaleString()}` : "",
    album_credit_expiry_months: studio.album_credit_expiry_months != null ? `${studio.album_credit_expiry_months} months` : "",
    rescheduling_fee_pct: studio.rescheduling_fee_pct != null ? `${studio.rescheduling_fee_pct}%` : "",
    sbv_signer_name: studio.signer_name ?? "",
    today_date: today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    today_year: String(today.getFullYear()),
  };
  return v;
}

const PLACEHOLDER_RE = /\{([a-z_][a-z0-9_]*)\}/g;

/** Resolve placeholders in HTML or plain text. Unknown tokens kept literal. */
export function resolvePlaceholders(content: string, ctx: TemplatingContext): string {
  const values = buildContextValues(ctx);
  return content.replace(PLACEHOLDER_RE, (full, key) => {
    if (key in values && values[key] !== "") return escapeHtml(values[key]);
    return full;
  });
}

/** Like resolvePlaceholders but wraps unknown/empty tokens in a gray span. */
export function resolvePlaceholdersWithMarkers(content: string, ctx: TemplatingContext): string {
  const values = buildContextValues(ctx);
  return content.replace(PLACEHOLDER_RE, (full, key) => {
    if (key in values && values[key] !== "") return escapeHtml(values[key]);
    return `<span style="color:#999;background:#f3f3f3;padding:0 4px;border-radius:3px;font-size:0.95em;">${full}</span>`;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

export const SAMPLE_CONTEXT: TemplatingContext = {
  client: {
    couple_name_1: "Sophia",
    couple_name_2: "Ethan",
    wedding_date: "2027-02-24",
    venue_name: "Gilbertsville Farmhouse",
    venue_street: "397 NY-51",
    venue_city: "Gilbertsville",
    venue_state: "NY",
    venue_postal_code: "13776",
    primary_email: "sophia@example.com",
    secondary_email: "ethan@example.com",
    primary_client_last_name: "Reyes",
    alternate_client_last_name: "Marlowe",
    primary_client_phone: "(555) 123-4567",
    alternate_client_phone: "(555) 234-5678",
    shared_street_address: "123 Main St",
    shared_city: "Brooklyn",
    shared_state: "NY",
    shared_zipcode: "11201",
  },
  contractor: { full_name: "Sample Contractor", email: "sample@example.com" },
  serviceRequest: { role: "second_shooter", agreed_hourly_rate: 75, agreed_hours: 8, agreed_total: 600 },
  timeline: { ceremony_start_time: "17:00:00", coverage_end_time: "23:00:00" },
  studio: {
    name: "Stories by Victoria",
    photographer_name: "Victoria Boustani",
    photographer_company: "Stories by Victoria",
    studio_email: "hello@victoriaboustani.com",
    studio_phone: "(555) 999-1234",
    studio_address: "123 Studio Way, Brooklyn, NY 11201",
    studio_mailing_address: "PO Box 4567, Brooklyn, NY 11202",
    ein: "12-3456789",
    instagram: "@storiesbyvictoria",
    website: "https://victoriaboustani.com",
    overage_hourly_rate: 700,
    video_cancellation_fee: 1500,
    album_credit_expiry_months: 8,
    rescheduling_fee_pct: 25,
    signer_name: "Victoria",
  },
};
