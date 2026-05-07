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

    contractor_name: co.full_name ?? "",
    contractor_first_name: (co.full_name ?? "").split(" ")[0] ?? "",
    contractor_role: roleLabel(sr.role ?? null),
    hourly_rate: sr.agreed_hourly_rate != null ? `$${sr.agreed_hourly_rate}/hr` : "",
    agreed_hours: sr.agreed_hours != null ? `${sr.agreed_hours} hours` : "",
    total_compensation: sr.agreed_total != null ? `$${sr.agreed_total}` : "",

    studio_name: studio.name ?? "Stories by Victoria",
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
    .replace(/>/g, "&gt;");
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
  },
  contractor: { full_name: "Sample Contractor", email: "sample@example.com" },
  serviceRequest: { role: "second_shooter", agreed_hourly_rate: 75, agreed_hours: 8, agreed_total: 600 },
  timeline: { ceremony_start_time: "17:00:00", coverage_end_time: "23:00:00" },
  studio: { name: "Stories by Victoria", signer_name: "Victoria" },
};
