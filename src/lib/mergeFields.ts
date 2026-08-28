// Real merge-field substitution for client-facing content (resources, notes).
// Same {field} syntax as workflow email templates (see workflow-constants
// MERGE_FIELDS), but resolved against an actual client record.

export interface MergeClient {
  couple_name_1?: string | null;
  couple_name_2?: string | null;
  primary_client_last_name?: string | null;
  alternate_client_last_name?: string | null;
  wedding_date?: string | null;
  venue_name?: string | null;
}

function firstName(s: string | null | undefined): string {
  return (s ?? "").trim().split(/\s+/)[0] ?? "";
}

export function substituteForClient(text: string, client: MergeClient | null | undefined, origin?: string): string {
  if (!text) return text;
  const c = client ?? {};
  const n1 = firstName(c.couple_name_1);
  const n2 = firstName(c.couple_name_2);
  const firsts = n2 ? `${n1} & ${n2}` : n1;
  const full1 = [c.couple_name_1, c.primary_client_last_name].filter(Boolean).join(" ").trim();
  const full2 = [c.couple_name_2, c.alternate_client_last_name].filter(Boolean).join(" ").trim();
  const fulls = full2 ? `${full1} & ${full2}` : full1;

  let dateLong = "";
  let dateShort = "";
  let daysUntil = "";
  if (c.wedding_date) {
    const d = new Date(c.wedding_date + "T12:00:00");
    if (!Number.isNaN(d.getTime())) {
      dateLong = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      dateShort = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
      daysUntil = days > 0 ? String(days) : "0";
    }
  }

  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const values: Record<string, string> = {
    "{couple_first_names}": firsts,
    "{couple_full_names}": fulls || firsts,
    "{wedding_date_long}": dateLong,
    "{wedding_date_short}": dateShort,
    "{days_until_wedding}": daysUntil,
    "{venue_name}": c.venue_name ?? "",
    "{photographer_name}": "Victoria",
    "{studio_email}": "victoria@victoriaboustani.com",
    "{studio_signature}": "with care, Stories by Victoria",
    "{portal_url}": base ? `${base}/portal` : "",
  };

  let out = text;
  for (const [field, value] of Object.entries(values)) out = out.split(field).join(value);
  return out;
}
