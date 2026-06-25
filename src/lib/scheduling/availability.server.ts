// Server-only availability engine for the scheduling system (Slice 3).
//
// Inputs come from:
//   - call_types.duration_minutes        (per call type)
//   - scheduling_settings                (timezone, buffer_minutes, min_lead_time_hours, lookahead_days,
//                                         primary_calendar_id, also_busy_from_calendar_ids)
//   - calendar_availability_rules        (weekly windows; one row per window)
//   - business_calendar_holidays         (dates skipped entirely)
//   - bookings (status='confirmed')      (always-on busy source)
//   - Google Calendar free/busy          (fail-soft: missing/errored → ignored)
//
// Output: an array of UTC slot instants for the requested range.
// DST is handled naturally because we walk day-by-day in studio local time
// and convert each wall-clock minute back to a UTC instant via Intl.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProviderClient } from "./provider-client.server";

export type SlotDTO = { startUtc: string; endUtc: string };
export type BusyInterval = { startMs: number; endMs: number };
export type WeeklyWindow = {
  weekdays: number[]; // 0=Sun..6=Sat
  startMinutes: number; // minutes from local midnight
  endMinutes: number;
};

export type GenerateInput = {
  durationMinutes: number;
  timezone: string;
  bufferMinutes: number;
  minLeadTimeHours: number;
  lookaheadDays: number;
  windows: WeeklyWindow[];
  holidays: Set<string>; // 'YYYY-MM-DD' in studio tz
  busyIntervals: BusyInterval[];
  fromMs: number;
  toMs: number;
  nowMs?: number;
  stepMinutes?: number; // default 15
};

const STEP_DEFAULT = 15;

// Minutes east of UTC for a given UTC instant in a given IANA timezone.
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return Math.round((asUTC - utcMs) / 60000);
}

// Convert a wall-clock (y,m,d,h,min) in tz to a UTC instant (ms).
// Handles DST by re-checking the offset after the first guess.
function wallTimeToUtcMs(
  y: number,
  m: number, // 1-12
  d: number,
  h: number,
  min: number,
  tz: string,
): number {
  let guess = Date.UTC(y, m - 1, d, h, min);
  const off1 = tzOffsetMinutes(guess, tz);
  let ms = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(ms, tz);
  if (off2 !== off1) ms += (off1 - off2) * 60000;
  return ms;
}

// Returns { y, m, d, weekday } in studio tz for a UTC instant.
function localParts(utcMs: number, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    weekday: wdMap[parts.weekday],
  };
}

function isoDate(y: number, m: number, d: number) {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

// Parse "HH:MM" or "HH:MM:SS" → minutes from midnight.
export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

export function normalizeWindowsFromRows(
  rows: Array<{
    available_days: unknown;
    available_hours: unknown;
    is_active: boolean | null;
  }>,
): WeeklyWindow[] {
  const out: WeeklyWindow[] = [];
  for (const r of rows) {
    if (r.is_active === false) continue;
    const days = Array.isArray(r.available_days)
      ? (r.available_days as unknown[]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : [];
    if (!days.length) continue;
    const hrs = r.available_hours as { start?: string; end?: string } | null;
    if (!hrs?.start || !hrs?.end) continue;
    const startMinutes = parseHHMM(hrs.start);
    const endMinutes = parseHHMM(hrs.end);
    if (endMinutes <= startMinutes) continue;
    out.push({ weekdays: days, startMinutes, endMinutes });
  }
  return out;
}

function overlapsBuffered(
  busy: BusyInterval[],
  startMs: number,
  endMs: number,
  bufferMs: number,
): boolean {
  for (const b of busy) {
    if (startMs < b.endMs + bufferMs && endMs > b.startMs - bufferMs) return true;
  }
  return false;
}

export function generateSlots(input: GenerateInput): SlotDTO[] {
  const {
    durationMinutes,
    timezone,
    bufferMinutes,
    minLeadTimeHours,
    lookaheadDays,
    windows,
    holidays,
    busyIntervals,
    fromMs,
    toMs,
    nowMs = Date.now(),
    stepMinutes = STEP_DEFAULT,
  } = input;

  if (durationMinutes <= 0 || !windows.length) return [];

  const earliest = nowMs + minLeadTimeHours * 3_600_000;
  const horizon = nowMs + lookaheadDays * 86_400_000;
  const rangeFrom = Math.max(fromMs, earliest);
  const rangeTo = Math.min(toMs, horizon);
  if (rangeTo <= rangeFrom) return [];

  const bufferMs = bufferMinutes * 60_000;
  const durationMs = durationMinutes * 60_000;

  // Walk by local date in studio tz, starting one day before rangeFrom (window
  // might begin in evening; cheap guard) and ending at the day containing rangeTo.
  const startDay = localParts(rangeFrom - 86_400_000, timezone);
  const endDay = localParts(rangeTo, timezone);

  // Iterate by incrementing wall-date directly to avoid DST drift.
  let y = startDay.y, m = startDay.m, d = startDay.d;
  const endKey = isoDate(endDay.y, endDay.m, endDay.d);

  const out: SlotDTO[] = [];
  // Safety cap: lookahead can be large, but iterations are bounded.
  for (let dayGuard = 0; dayGuard < 400; dayGuard++) {
    const dateKey = isoDate(y, m, d);
    // Compute weekday of this local date via a noon-UTC-conversion (noon avoids DST edge).
    const noonMs = wallTimeToUtcMs(y, m, d, 12, 0, timezone);
    const wd = localParts(noonMs, timezone).weekday;

    if (!holidays.has(dateKey)) {
      for (const w of windows) {
        if (!w.weekdays.includes(wd)) continue;
        const latestStart = w.endMinutes - durationMinutes;
        if (latestStart < w.startMinutes) continue;
        for (let mins = w.startMinutes; mins <= latestStart; mins += stepMinutes) {
          const startMs = wallTimeToUtcMs(y, m, d, Math.floor(mins / 60), mins % 60, timezone);
          if (startMs < rangeFrom) continue;
          if (startMs >= rangeTo) continue;
          const endMs = startMs + durationMs;
          if (overlapsBuffered(busyIntervals, startMs, endMs, bufferMs)) continue;
          out.push({
            startUtc: new Date(startMs).toISOString(),
            endUtc: new Date(endMs).toISOString(),
          });
        }
      }
    }

    if (dateKey === endKey) break;
    // increment date
    const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }

  // Sort + dedupe (multiple windows could theoretically overlap)
  out.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return out.filter((s, i) => i === 0 || s.startUtc !== out[i - 1].startUtc);
}

// ---------------------------------------------------------------------------
// Data loaders + Google free/busy (fail-soft)
// ---------------------------------------------------------------------------

export type LoadedInputs = {
  callType: { id: string; slug: string; name: string; duration_minutes: number; is_active: boolean };
  ownerUserId: string;
  settings: {
    timezone: string;
    buffer_minutes: number;
    min_lead_time_hours: number;
    lookahead_days: number;
    primary_calendar_id: string | null;
    also_busy_from_calendar_ids: string[] | null;
  };
  windows: WeeklyWindow[];
  holidays: Set<string>;
};

export async function loadInputsForSlug(slug: string): Promise<LoadedInputs | null> {
  const { data: callType, error: ctErr } = await supabaseAdmin
    .from("call_types")
    .select("id, slug, name, duration_minutes, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (ctErr) throw ctErr;
  if (!callType) return null;

  // Single-studio assumption: one scheduling_settings row.
  const { data: settings, error: sErr } = await supabaseAdmin
    .from("scheduling_settings")
    .select(
      "owner_user_id, timezone, buffer_minutes, min_lead_time_hours, lookahead_days, primary_calendar_id, also_busy_from_calendar_ids",
    )
    .limit(1)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!settings) return null;

  const ownerUserId = settings.owner_user_id as string;

  const { data: ruleRows, error: rErr } = await supabaseAdmin
    .from("calendar_availability_rules")
    .select("available_days, available_hours, is_active")
    .eq("user_id", ownerUserId);
  if (rErr) throw rErr;

  const { data: holRows, error: hErr } = await supabaseAdmin
    .from("business_calendar_holidays")
    .select("holiday_date, is_observed");
  if (hErr) throw hErr;
  const holidays = new Set(
    (holRows ?? [])
      .filter((h: { is_observed: boolean | null }) => h.is_observed !== false)
      .map((h: { holiday_date: string }) => h.holiday_date),
  );

  return {
    callType: callType as LoadedInputs["callType"],
    ownerUserId,
    settings: {
      timezone: settings.timezone as string,
      buffer_minutes: settings.buffer_minutes as number,
      min_lead_time_hours: settings.min_lead_time_hours as number,
      lookahead_days: settings.lookahead_days as number,
      primary_calendar_id: (settings.primary_calendar_id as string | null) ?? null,
      also_busy_from_calendar_ids: (settings.also_busy_from_calendar_ids as string[] | null) ?? [],
    },
    windows: normalizeWindowsFromRows((ruleRows ?? []) as Parameters<typeof normalizeWindowsFromRows>[0]),
    holidays,
  };
}

export async function loadBookingBusy(
  fromMs: number,
  toMs: number,
): Promise<BusyInterval[]> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("starts_at, ends_at, status")
    .eq("status", "confirmed")
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso);
  if (error) throw error;
  return (data ?? []).map((r: { starts_at: string; ends_at: string }) => ({
    startMs: Date.parse(r.starts_at),
    endMs: Date.parse(r.ends_at),
  }));
}

// Google free/busy — fail-soft. Returns [] if not connected, no calendar
// configured, or any provider error. Never throws.
export async function loadGoogleBusy(
  ownerUserId: string,
  calendarIds: string[],
  fromMs: number,
  toMs: number,
): Promise<BusyInterval[]> {
  if (!calendarIds.length) return [];
  try {
    const client = await getProviderClient("google", ownerUserId);
    const body = {
      timeMin: new Date(fromMs).toISOString(),
      timeMax: new Date(toMs).toISOString(),
      items: calendarIds.map((id) => ({ id })),
    };
    const res = await client.fetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.warn("[availability] google freeBusy non-ok", res.status);
      return [];
    }
    const json = (await res.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };
    const out: BusyInterval[] = [];
    for (const cal of Object.values(json.calendars ?? {})) {
      for (const b of cal.busy ?? []) {
        out.push({ startMs: Date.parse(b.start), endMs: Date.parse(b.end) });
      }
    }
    return out;
  } catch (e) {
    console.warn("[availability] google freeBusy fail-soft:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Multi-account Google free/busy — UNION across ALL active Google connections
// for the owner. Fail-soft PER CONNECTION: an expired/revoked/erroring account
// returns [] but does not blank out other accounts.
// ---------------------------------------------------------------------------
export async function loadAllGoogleBusy(
  ownerUserId: string,
  fromMs: number,
  toMs: number,
): Promise<BusyInterval[]> {
  let connections: Array<{ id: string; busy_calendar_ids: string[] }>;
  try {
    const { listActiveConnections } = await import("./provider-client.server");
    connections = (await listActiveConnections("google", ownerUserId)).map((c) => ({
      id: c.id,
      busy_calendar_ids: c.busy_calendar_ids?.length ? c.busy_calendar_ids : ["primary"],
    }));
  } catch (e) {
    console.warn("[availability] listActiveConnections fail-soft:", e instanceof Error ? e.message : e);
    return [];
  }
  if (!connections.length) return [];

  const results = await Promise.all(
    connections.map(async (conn) => {
      try {
        const client = await getProviderClient("google", ownerUserId, { connectionId: conn.id });
        const body = {
          timeMin: new Date(fromMs).toISOString(),
          timeMax: new Date(toMs).toISOString(),
          items: conn.busy_calendar_ids.map((id) => ({ id })),
        };
        const res = await client.fetch(
          "https://www.googleapis.com/calendar/v3/freeBusy",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          console.warn(`[availability] google freeBusy non-ok for connection ${conn.id}:`, res.status);
          return [] as BusyInterval[];
        }
        const json = (await res.json()) as {
          calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
        };
        const out: BusyInterval[] = [];
        for (const cal of Object.values(json.calendars ?? {})) {
          for (const b of cal.busy ?? []) {
            out.push({ startMs: Date.parse(b.start), endMs: Date.parse(b.end) });
          }
        }
        return out;
      } catch (e) {
        console.warn(`[availability] google freeBusy fail-soft for connection ${conn.id}:`, e instanceof Error ? e.message : e);
        return [] as BusyInterval[];
      }
    }),
  );
  return results.flat();
}
