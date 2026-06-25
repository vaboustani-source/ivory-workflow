// Server-only: getOwnerAvailability — read-only feed for the studio availability
// dashboard.
//
// Account designation:
//   - PROFESSIONAL = the calendar_connections row whose id equals
//     scheduling_settings.booking_calendar_connection_id. For this account we
//     fetch real events via Google events.list and return their summaries —
//     Victoria wants to see her actual appointments.
//   - PERSONAL = every OTHER active Google connection for the same owner.
//     We only fetch freeBusy and return UNTITLED busy blocks (privacy).
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
  /** Untitled busy from PERSONAL Google connections + booked calls. */
  busy: DashboardBusy[];
  /** Titled events from the PROFESSIONAL Google connection. */
  professionalEvents: DashboardEvent[];
  bookings: DashboardBooking[];
  professional: {
    connectionId: string | null;
    accountEmail: string | null;
  };
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
          .select("id, account_email, busy_calendar_ids")
          .eq("user_id", ownerUserId)
          .eq("provider", "google")
          .eq("is_active", true),
      ]);

    const { normalizeWindowsFromRows, loadGoogleBusy } = await import(
      "./availability.server"
    );
    const { getProviderClient } = await import("./provider-client.server");

    const windows = normalizeWindowsFromRows(
      (ruleRows ?? []) as Parameters<typeof normalizeWindowsFromRows>[0],
    );
    const holidays = (holRows ?? [])
      .filter((h: { is_observed: boolean | null }) => h.is_observed !== false)
      .map((h: { holiday_date: string }) => h.holiday_date);

    const connections = (connRows ?? []) as Array<{
      id: string;
      account_email: string | null;
      busy_calendar_ids: string[] | null;
    }>;
    const professionalConn =
      connections.find((c) => c.id === professionalConnectionId) ?? null;
    const personalConns = connections.filter(
      (c) => c.id !== professionalConnectionId,
    );

    // --- Professional: real events with titles (fail-soft) ---
    const professionalEvents: DashboardEvent[] = [];
    if (professionalConn) {
      const calendarIds = professionalConn.busy_calendar_ids?.length
        ? professionalConn.busy_calendar_ids
        : ["primary"];
      try {
        const client = await getProviderClient("google", ownerUserId, {
          connectionId: professionalConn.id,
        });
        for (const calId of calendarIds) {
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
              continue;
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
              }>;
            };
            for (const ev of json.items ?? []) {
              if (ev.status === "cancelled") continue;
              if (ev.transparency === "transparent") continue; // free/non-blocking
              const startIso = ev.start?.dateTime ?? ev.start?.date;
              const endIso = ev.end?.dateTime ?? ev.end?.date;
              if (!startIso || !endIso) continue;
              professionalEvents.push({
                id: ev.id,
                title: ev.summary?.trim() || "(Untitled event)",
                startUtc: new Date(startIso).toISOString(),
                endUtc: new Date(endIso).toISOString(),
                location: ev.location ?? null,
                htmlLink: ev.htmlLink ?? null,
              });
            }
          } catch (e) {
            console.warn("[dashboard] events.list fail-soft", calId, e);
          }
        }
      } catch (e) {
        console.warn("[dashboard] professional client fail-soft", e);
      }
    }

    // --- Personal: untitled busy blocks (fail-soft per connection) ---
    const personalBusyResults = await Promise.all(
      personalConns.map(async (c) => {
        const ids = c.busy_calendar_ids?.length ? c.busy_calendar_ids : ["primary"];
        try {
          const client = await getProviderClient("google", ownerUserId, {
            connectionId: c.id,
          });
          // Reuse loadGoogleBusy's body inline via a one-off freeBusy call.
          const res = await client.fetch(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                timeMin: new Date(fromMs).toISOString(),
                timeMax: new Date(toMs).toISOString(),
                items: ids.map((id) => ({ id })),
              }),
            },
          );
          if (!res.ok) return [] as DashboardBusy[];
          const json = (await res.json()) as {
            calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
          };
          const out: DashboardBusy[] = [];
          for (const cal of Object.values(json.calendars ?? {})) {
            for (const b of cal.busy ?? []) {
              out.push({ startUtc: b.start, endUtc: b.end });
            }
          }
          return out;
        } catch (e) {
          console.warn("[dashboard] personal busy fail-soft", c.account_email, e);
          return [] as DashboardBusy[];
        }
      }),
    );
    void loadGoogleBusy; // keep import used if tree-shaker complains

    // System bookings → first-class + also contribute to busy for consistency.
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

    const busy: DashboardBusy[] = [
      ...personalBusyResults.flat(),
      ...bookings.map((b) => ({ startUtc: b.startUtc, endUtc: b.endUtc })),
    ];

    return {
      ownerUserId,
      studioTimezone: tz,
      windows,
      holidays,
      busy,
      professionalEvents,
      bookings,
      professional: {
        connectionId: professionalConn?.id ?? null,
        accountEmail: professionalConn?.account_email ?? null,
      },
      personalAccountEmails: personalConns
        .map((c) => c.account_email)
        .filter((e): e is string => !!e),
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

    // Verify the designated connection is active + Google. Refuse any other.
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

// Optional delete helper (used for test cleanup; safe to expose to owner/manager).
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
