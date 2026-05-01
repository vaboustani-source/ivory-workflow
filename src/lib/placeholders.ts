// Placeholder resolution for contract templates.
// Replaces {placeholder} tokens with values from the supplied context.

export interface PlaceholderContext {
  couple_first_names?: string;     // e.g., "Sophia & James"
  couple_full_names?: string;      // full names if known
  wedding_date_long?: string;      // "Saturday, June 14, 2026"
  wedding_date_short?: string;     // "06/14/2026"
  venue_name?: string;
  photographer_name?: string;
  studio_email?: string;
  studio_signature?: string;
}

export const SAMPLE_CONTEXT: PlaceholderContext = {
  couple_first_names: "Sarah & James",
  couple_full_names: "Sarah Mitchell & James Carter",
  wedding_date_long: "Saturday, June 14, 2026",
  wedding_date_short: "06/14/2026",
  venue_name: "The Boathouse at Oakmoor",
  photographer_name: "Victoria Boustani",
  studio_email: "hello@victoriaboustani.com",
  studio_signature: "with care,\nStories by Victoria",
};

export const PLACEHOLDER_LIST = [
  "couple_first_names",
  "couple_full_names",
  "wedding_date_long",
  "wedding_date_short",
  "venue_name",
  "photographer_name",
  "studio_email",
  "studio_signature",
] as const;

export function resolvePlaceholders(content: string, ctx: PlaceholderContext): string {
  return content.replace(/\{(\w+)\}/g, (match, key) => {
    const v = (ctx as any)[key];
    return v != null ? String(v) : match;
  });
}

function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
    return d.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch { return ""; }
}
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
    return d.toLocaleDateString("en-US");
  } catch { return ""; }
}

export function buildClientPlaceholderContext(client: {
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  venue_name: string | null;
  primary_email: string | null;
}, photographerName?: string | null, studioEmail?: string): PlaceholderContext {
  const first = client.couple_name_1 + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");
  return {
    couple_first_names: first,
    couple_full_names: first,
    wedding_date_long: formatDateLong(client.wedding_date),
    wedding_date_short: formatDateShort(client.wedding_date),
    venue_name: client.venue_name ?? "",
    photographer_name: photographerName ?? "Victoria Boustani",
    studio_email: studioEmail ?? "hello@victoriaboustani.com",
    studio_signature: "with care,\nStories by Victoria",
  };
}
