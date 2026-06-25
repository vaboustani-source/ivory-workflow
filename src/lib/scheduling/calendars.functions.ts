// Server-only: list every Google calendar across the owner's active
// connections, and persist per-calendar busy/titled selections.
//
//   busy_calendar_ids   = calendars that COUNT as busy (block availability)
//   titled_calendar_ids = subset of busy whose events show WITH titles on the
//                         dashboard. Calendars in busy but not in titled show
//                         as "Busy (private)" untitled blocks.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type CalendarEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
  included: boolean; // in busy_calendar_ids
  titled: boolean; // in titled_calendar_ids
};

export type ConnectionCalendars = {
  connectionId: string;
  accountEmail: string | null;
  isProfessional: boolean;
  calendars: CalendarEntry[];
  error?: string;
};

export type ListGoogleCalendarsResponse = {
  professionalConnectionId: string | null;
  connections: ConnectionCalendars[];
};

async function assertOwnerOrManager(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const set = new Set((roles ?? []).map((r) => r.role));
  if (!set.has("owner") && !set.has("studio_manager")) {
    throw new Error("forbidden");
  }
}

async function getOwnerUserId(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("scheduling_settings")
    .select("owner_user_id, booking_calendar_connection_id")
    .limit(1)
    .maybeSingle();
  if (!data?.owner_user_id) throw new Error("scheduling_settings not initialised");
  return data.owner_user_id as string;
}

export const listGoogleCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ListGoogleCalendarsResponse> => {
    await assertOwnerOrManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getProviderClient } = await import("./provider-client.server");

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("owner_user_id, booking_calendar_connection_id")
      .limit(1)
      .maybeSingle();
    if (!settings?.owner_user_id) throw new Error("scheduling_settings not initialised");
    const ownerUserId = settings.owner_user_id as string;
    const professionalId =
      (settings as { booking_calendar_connection_id?: string | null })
        .booking_calendar_connection_id ?? null;

    const { data: connRows } = await supabaseAdmin
      .from("calendar_connections")
      .select("id, account_email, busy_calendar_ids, titled_calendar_ids")
      .eq("user_id", ownerUserId)
      .eq("provider", "google")
      .eq("is_active", true);

    const connections = (connRows ?? []) as Array<{
      id: string;
      account_email: string | null;
      busy_calendar_ids: string[] | null;
      titled_calendar_ids: string[] | null;
    }>;

    const results: ConnectionCalendars[] = await Promise.all(
      connections.map(async (c) => {
        const busySet = new Set(c.busy_calendar_ids ?? []);
        const titledSet = new Set(c.titled_calendar_ids ?? []);
        try {
          const client = await getProviderClient("google", ownerUserId, {
            connectionId: c.id,
          });
          const res = await client.fetch(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
          );
          if (!res.ok) {
            return {
              connectionId: c.id,
              accountEmail: c.account_email,
              isProfessional: c.id === professionalId,
              calendars: [],
              error: `calendarList ${res.status}`,
            };
          }
          const json = (await res.json()) as {
            items?: Array<{
              id: string;
              summary?: string;
              primary?: boolean;
              accessRole?: string;
              timeZone?: string;
            }>;
          };
          const calendars: CalendarEntry[] = (json.items ?? []).map((cal) => ({
            id: cal.id,
            summary: cal.summary ?? cal.id,
            primary: !!cal.primary,
            accessRole: cal.accessRole ?? "reader",
            timeZone: cal.timeZone ?? null,
            included: busySet.has(cal.id),
            titled: titledSet.has(cal.id),
          }));
          // Stable sort: primary first, then by summary.
          calendars.sort((a, b) => {
            if (a.primary !== b.primary) return a.primary ? -1 : 1;
            return a.summary.localeCompare(b.summary);
          });
          return {
            connectionId: c.id,
            accountEmail: c.account_email,
            isProfessional: c.id === professionalId,
            calendars,
          };
        } catch (e) {
          return {
            connectionId: c.id,
            accountEmail: c.account_email,
            isProfessional: c.id === professionalId,
            calendars: [],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    void getOwnerUserId; // satisfies tree-shaker

    return {
      professionalConnectionId: professionalId,
      connections: results,
    };
  });

const saveInput = z.object({
  connectionId: z.string().uuid(),
  busyCalendarIds: z.array(z.string().min(1)).max(100),
  titledCalendarIds: z.array(z.string().min(1)).max(100),
});

export type SaveCalendarSelectionsInput = z.infer<typeof saveInput>;

export const saveCalendarSelections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveCalendarSelectionsInput) => saveInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertOwnerOrManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ownerUserId = await getOwnerUserId();

    // Verify the connection belongs to this owner.
    const { data: conn } = await supabaseAdmin
      .from("calendar_connections")
      .select("id, user_id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn || conn.user_id !== ownerUserId) {
      throw new Error("connection not found");
    }

    const busy = Array.from(new Set(data.busyCalendarIds));
    const busySet = new Set(busy);
    // Enforce titled ⊆ busy
    const titled = Array.from(new Set(data.titledCalendarIds)).filter((id) =>
      busySet.has(id),
    );

    const { error } = await supabaseAdmin
      .from("calendar_connections")
      .update({
        busy_calendar_ids: busy,
        titled_calendar_ids: titled,
      })
      .eq("id", data.connectionId);
    if (error) throw error;

    try {
      await supabaseAdmin.from("activity_log").insert({
        user_id: context.userId,
        action_type: "calendar.selections_updated",
        target_type: "calendar_connection",
        target_id: data.connectionId,
        description: "Updated calendar busy/titled selections",
        metadata: { busy, titled },
      });
    } catch {
      // non-fatal
    }

    return { ok: true };
  });
