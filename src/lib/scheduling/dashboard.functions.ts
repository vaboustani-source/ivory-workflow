// Server-only: getOwnerAvailability — read-only feed for the studio availability
// dashboard.
//
// Per-calendar model (drives both this dashboard and the public booking
// availability engine):
//   busy_calendar_ids   = every calendar that should COUNT as busy
//   titled_calendar_ids = subset of busy whose events show WITH titles.
//                         A calendar in busy but NOT titled is fetched via
//                         freeBusy and rendered as an untitled "Busy (private)"
//                         block.
//
// System bookings remain first-class (couple + call type + Zoom join).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const inputSchema = z.object({
  fromIso: z.string().datetime(),
  toIso: z.string().datetime(),
});

const MAX_RANGE_DAYS = 31;

export type DashboardWindow = {
  weekdays: number[];
  startMinutes: number;
  endMinutes: number;
};

export type DashboardBusy = { startUtc: string; endUtc: string };
export type DashboardEvent = {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  location: string | null;
  htmlLink: string | null;
  allDay: boolean;
};

export type DashboardBooking = {
  id: string;
  callTypeName: string;
  coupleName: string;
  startUtc: string;
  endUtc: string;
  zoomJoinUrl: string | null;
};

export type OwnerAvailabilityResponse = {
  ownerUserId: string;
  studioTimezone: string;
  windows: DashboardWindow[];
  holidays: string[];
  /** Untitled busy blocks from any calendar in busy but NOT in titled. */
  privateBusy: DashboardBusy[];
  /** Titled events from calendars in titled_calendar_ids. */
  titledEvents: DashboardEvent[];
  bookings: DashboardBooking[];
  /** Connected Google accounts (for diagnostics in UI). */
  accountEmails: string[];
  professionalAccountEmail: string | null;
  professionalConnectionId: string | null;
  // ----- Back-compat aliases (deprecated, will be removed) -----
  /** @deprecated use privateBusy */
  busy: DashboardBusy[];
  /** @deprecated use titledEvents */
  professionalEvents: DashboardEvent[];
  /** @deprecated use professionalConnectionId / professionalAccountEmail */
  professional: { connectionId: string | null; accountEmail: string | null };
  /** @deprecated */
  personalAccountEmails: string[];
};

async function assertOwnerOrManager(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roleSet = new Set((roles ?? []).map((r) => r.role));
  if (!roleSet.has("owner") && !roleSet.has("studio_manager")) {
    throw new Error("forbidden");
  }
}

// --- Date helpers (local-midnight interpretation for all-day events) -------

// Minutes east of UTC for a given UTC instant in the given IANA timezone.
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
  return Math.round((asUTC - utcMs) / 60_000);
}

/**
 * Convert an all-day "YYYY-MM-DD" boundary to a UTC instant representing
 * local midnight in the studio timezone. Used so an all-day Jul 4 event
 * spans Jul 4 00:00 → Jul 5 00:00 local, not UTC.
 */
function dateOnlyToLocalMidnightUtc(dateOnly: string, tz: string): string {
  const [y, m, d] = dateOnly.split("-").map((x) => parseInt(x, 10));
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const off1 = tzOffsetMinutes(guess, tz);
  let ms = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(ms, tz);
  if (off2 !== off1) ms += (off1 - off2) * 60_000;
  return new Date(ms).toISOString();
}

function normalizeEventBound(
  bound: { dateTime?: string; date?: string } | undefined,
  tz: string,
): { iso: string; allDay: boolean } | null {
  if (!bound) return null;
  if (bound.dateTime) {
    return { iso: new Date(bound.dateTime).toISOString(), allDay: false };
  }
  if (bound.date) {
    return { iso: dateOnlyToLocalMidnightUtc(bound.date, tz), allDay: true };
  }
  return null;
}

// Filter out events the owner has declined (self attendee responseStatus).
function selfDeclined(ev: {
  attendees?: Array<{ self?: boolean; responseStatus?: string; email?: string }>;
}): boolean {
  if (!ev.attendees?.length) return false;
  return ev.attendees.some(
    (a) => a.self === true && a.responseStatus === "declined",
  );
}

export const getOwnerAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fromIso: string; toIso: string }) =>
    inputSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<OwnerAvailabilityResponse> => {
    await assertOwnerOrManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const fromMs = Date.parse(data.fromIso);
    const toMs = Date.parse(data.toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("invalid range");
    }
    if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
      throw new Error(`range exceeds ${MAX_RANGE_DAYS} days`);
    }

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("owner_user_id, timezone, booking_calendar_connection_id")
      .limit(1)
      .maybeSingle();
    if (!settings?.owner_user_id) {
      throw new Error("scheduling_settings not initialised");
    }
    const ownerUserId = settings.owner_user_id as string;
    const tz = (settings.timezone as string) || "America/New_York";
    const professionalConnectionId =
      (settings as { booking_calendar_connection_id?: string | null })
        .booking_calendar_connection_id ?? null;

    const [{ data: ruleRows }, { data: holRows }, { data: bookingRows }, { data: connRows }] =
      await Promise.all([
        supabaseAdmin
          .from("calendar_availability_rules")
          .select("available_days, available_hours, is_active")
          .eq("user_id", ownerUserId),
        supabaseAdmin
          .from("business_calendar_holidays")
          .select("holiday_date, is_observed"),
        supabaseAdmin
          .from("bookings")
          .select(
            "id, starts_at, ends_at, status, zoom_join_url, couple_name_1, couple_name_2, call_type:call_types(name)",
          )
          .eq("status", "confirmed")
          .lt("starts_at", new Date(toMs).toISOString())
          .gt("ends_at", new Date(fromMs).toISOString()),
        supabaseAdmin
          .from("calendar_connections")
          .select("id, account_email, busy_calendar_ids, titled_calendar_ids")
          .eq("user_id", ownerUserId)
          .eq("provider", "google")
          .eq("is_active", true),
      ]);

    const { normalizeWindowsFromRows } = await import("./availability.server");
    const { getProviderClient } = await import("./provider-client.server");

    const windows = normalizeWindowsFromRows(
      (ruleRows ?? []) as Parameters<typeof normalizeWindowsFromRows>[0],
    );
    const holidays = (holRows ?? [])
      .filter((h: { is_observed: boolean | null }) => h.is_observed !== false)
      .map((h: { holiday_date: string }) => h.holiday_date);

    type Conn = {
      id: string;
      account_email: string | null;
      busy_calendar_ids: string[];
      titled_calendar_ids: string[];
    };
    const connections: Conn[] = ((connRows ?? []) as Array<{
      id: string;
      account_email: string | null;
      busy_calendar_ids: string[] | null;
      titled_calendar_ids: string[] | null;
    }>).map((c) => ({
      id: c.id,
      account_email: c.account_email,
      busy_calendar_ids: c.busy_calendar_ids?.length ? c.busy_calendar_ids : [],
      titled_calendar_ids: c.titled_calendar_ids ?? [],
    }));

    const titledEvents: DashboardEvent[] = [];
    const privateBusy: DashboardBusy[] = [];

    // Per connection, per calendar fan-out (fail-soft at every level).
    await Promise.all(
      connections.map(async (conn) => {
        if (!conn.busy_calendar_ids.length) return;
        let client;
        try {
          client = await getProviderClient("google", ownerUserId, {
            connectionId: conn.id,
          });
        } catch (e) {
          console.warn("[dashboard] provider client fail-soft", conn.account_email, e);
          return;
        }
        const titledSet = new Set(conn.titled_calendar_ids);

        await Promise.all(
          conn.busy_calendar_ids.map(async (calId) => {
            if (titledSet.has(calId)) {
              // events.list → titled
              try {
                const url =
                  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
                  `?singleEvents=true&orderBy=startTime` +
                  `&timeMin=${encodeURIComponent(new Date(fromMs).toISOString())}` +
                  `&timeMax=${encodeURIComponent(new Date(toMs).toISOString())}` +
                  `&maxResults=250`;
                const res = await client.fetch(url);
                if (!res.ok) {
                  console.warn("[dashboard] events.list non-ok", calId, res.status);
                  return;
                }
                const json = (await res.json()) as {
                  items?: Array<{
                    id: string;
                    summary?: string;
                    location?: string;
                    htmlLink?: string;
                    status?: string;
                    transparency?: string;
                    start?: { dateTime?: string; date?: string };
                    end?: { dateTime?: string; date?: string };
                    attendees?: Array<{
                      self?: boolean;
                      responseStatus?: string;
                      email?: string;
                    }>;
                  }>;
                };
                for (const ev of json.items ?? []) {
                  if (ev.status === "cancelled") continue;
                  if (ev.transparency === "transparent") continue;
                  if (selfDeclined(ev)) continue;
                  const start = normalizeEventBound(ev.start, tz);
                  const end = normalizeEventBound(ev.end, tz);
                  if (!start || !end) continue;
                  titledEvents.push({
                    id: `${conn.id}:${ev.id}`,
                    title: ev.summary?.trim() || "(Untitled event)",
                    startUtc: start.iso,
                    endUtc: end.iso,
                    location: ev.location ?? null,
                    htmlLink: ev.htmlLink ?? null,
                    allDay: start.allDay,
                  });
                }
              } catch (e) {
                console.warn("[dashboard] events.list fail-soft", calId, e);
              }
            } else {
              // freeBusy → untitled busy
              try {
                const res = await client.fetch(
                  "https://www.googleapis.com/calendar/v3/freeBusy",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      timeMin: new Date(fromMs).toISOString(),
                      timeMax: new Date(toMs).toISOString(),
                      items: [{ id: calId }],
                    }),
                  },
                );
                if (!res.ok) return;
                const json = (await res.json()) as {
                  calendars?: Record<
                    string,
                    { busy?: Array<{ start: string; end: string }> }
                  >;
                };
                for (const cal of Object.values(json.calendars ?? {})) {
                  for (const b of cal.busy ?? []) {
                    privateBusy.push({ startUtc: b.start, endUtc: b.end });
                  }
                }
              } catch (e) {
                console.warn("[dashboard] freeBusy fail-soft", calId, e);
              }
            }
          }),
        );
      }),
    );

    const bookings: DashboardBooking[] = (bookingRows ?? []).map((b) => {
      const coupleName = b.couple_name_2
        ? `${b.couple_name_1} & ${b.couple_name_2}`
        : (b.couple_name_1 as string);
      const ct = (b as unknown as { call_type: { name: string } | null }).call_type;
      return {
        id: b.id as string,
        callTypeName: ct?.name ?? "Call",
        coupleName,
        startUtc: b.starts_at as string,
        endUtc: b.ends_at as string,
        zoomJoinUrl: (b.zoom_join_url as string | null) ?? null,
      };
    });

    const professionalConn =
      connections.find((c) => c.id === professionalConnectionId) ?? null;
    const accountEmails = connections
      .map((c) => c.account_email)
      .filter((e): e is string => !!e);

    return {
      ownerUserId,
      studioTimezone: tz,
      windows,
      holidays,
      privateBusy,
      titledEvents,
      bookings,
      accountEmails,
      professionalAccountEmail: professionalConn?.account_email ?? null,
      professionalConnectionId: professionalConn?.id ?? null,
      // back-compat
      busy: privateBusy,
      professionalEvents: titledEvents,
      professional: {
        connectionId: professionalConn?.id ?? null,
        accountEmail: professionalConn?.account_email ?? null,
      },
      personalAccountEmails: accountEmails.filter(
        (e) => e !== professionalConn?.account_email,
      ),
    };
  });

// ---------------------------------------------------------------------------
// createOwnerCalendarEvent — owner+studio_manager only. Writes to the
// PROFESSIONAL Google connection's primary calendar. NEVER writes to a
// personal connection.
// ---------------------------------------------------------------------------
const createEventInput = z.object({
  title: z.string().trim().min(1).max(300),
  startUtcIso: z.string().datetime(),
  endUtcIso: z.string().datetime(),
  location: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export type CreateOwnerCalendarEventInput = z.infer<typeof createEventInput>;

export type CreateOwnerCalendarEventResult = {
  eventId: string;
  calendarId: string;
  accountEmail: string | null;
  htmlLink: string | null;
};

export const createOwnerCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateOwnerCalendarEventInput) =>
    createEventInput.parse(input),
  )
  .handler(async ({ data, context }): Promise<CreateOwnerCalendarEventResult> => {
    await assertOwnerOrManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getProviderClient } = await import("./provider-client.server");

    const startMs = Date.parse(data.startUtcIso);
    const endMs = Date.parse(data.endUtcIso);
    if (!(endMs > startMs)) throw new Error("end must be after start");

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("owner_user_id, booking_calendar_connection_id, booking_calendar_id")
      .limit(1)
      .maybeSingle();
    if (!settings?.owner_user_id) throw new Error("scheduling_settings not initialised");
    const ownerUserId = settings.owner_user_id as string;
    const professionalId =
      (settings as { booking_calendar_connection_id?: string | null })
        .booking_calendar_connection_id ?? null;
    if (!professionalId) {
      throw new Error(
        "No professional calendar designated. Set the booking calendar in scheduling settings.",
      );
    }

    const { data: conn } = await supabaseAdmin
      .from("calendar_connections")
      .select("id, account_email, is_active, provider")
      .eq("id", professionalId)
      .maybeSingle();
    if (!conn || !conn.is_active || conn.provider !== "google") {
      throw new Error("Professional Google connection is not active.");
    }

    const calendarId =
      ((settings as { booking_calendar_id?: string | null }).booking_calendar_id ?? null) ||
      "primary";

    const client = await getProviderClient("google", ownerUserId, {
      connectionId: professionalId,
    });
    const body = {
      summary: data.title,
      description: data.notes ?? undefined,
      location: data.location ?? undefined,
      start: { dateTime: data.startUtcIso, timeZone: "UTC" },
      end: { dateTime: data.endUtcIso, timeZone: "UTC" },
      reminders: { useDefault: true },
    };
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events?sendUpdates=none`;
    const res = await client.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`google create event ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as { id: string; htmlLink?: string };

    try {
      await supabaseAdmin.from("activity_log").insert({
        user_id: context.userId,
        action_type: "calendar.event_created",
        target_type: "calendar_event",
        target_id: json.id,
        description: `Added calendar appointment "${data.title}"`,
        metadata: {
          calendar_connection_id: professionalId,
          calendar_id: calendarId,
          start: data.startUtcIso,
          end: data.endUtcIso,
        },
      });
    } catch (e) {
      console.warn("[dashboard] activity_log insert failed", e);
    }

    return {
      eventId: json.id,
      calendarId,
      accountEmail: conn.account_email as string | null,
      htmlLink: json.htmlLink ?? null,
    };
  });

const deleteEventInput = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().min(1).optional(),
});

export const deleteOwnerCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventId: string; calendarId?: string }) =>
    deleteEventInput.parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await assertOwnerOrManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getProviderClient } = await import("./provider-client.server");

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("owner_user_id, booking_calendar_connection_id, booking_calendar_id")
      .limit(1)
      .maybeSingle();
    if (!settings?.owner_user_id) throw new Error("scheduling_settings not initialised");
    const professionalId =
      (settings as { booking_calendar_connection_id?: string | null })
        .booking_calendar_connection_id ?? null;
    if (!professionalId) throw new Error("no professional connection");

    const calendarId =
      data.calendarId ||
      ((settings as { booking_calendar_id?: string | null }).booking_calendar_id ?? null) ||
      "primary";

    const client = await getProviderClient("google", settings.owner_user_id as string, {
      connectionId: professionalId,
    });
    const res = await client.fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${encodeURIComponent(data.eventId)}?sendUpdates=none`,
      { method: "DELETE" },
    );
    return { ok: res.ok || res.status === 410 || res.status === 404 };
  });
