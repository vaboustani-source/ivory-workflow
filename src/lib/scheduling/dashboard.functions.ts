// Server-only: getOwnerAvailability — read-only feed for the studio availability
// dashboard. Returns the configured weekly windows, busy intervals (UNION of
// all owner Google accounts + confirmed bookings), and upcoming booked calls
// (system-owned bookings only — we DO surface call type + couple name on
// those, since they're our own data). External calendar event titles are NEVER
// returned; only busy/free for those.

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
  busy: DashboardBusy[];
  bookings: DashboardBooking[];
};

export const getOwnerAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fromIso: string; toIso: string }) =>
    inputSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<OwnerAvailabilityResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Role gate: owner or studio_manager only.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleSet = new Set((roles ?? []).map((r) => r.role));
    if (!roleSet.has("owner") && !roleSet.has("studio_manager")) {
      throw new Error("forbidden");
    }

    const fromMs = Date.parse(data.fromIso);
    const toMs = Date.parse(data.toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("invalid range");
    }
    if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
      throw new Error(`range exceeds ${MAX_RANGE_DAYS} days`);
    }

    // Resolve owner from scheduling_settings (single-studio).
    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("owner_user_id, timezone")
      .limit(1)
      .maybeSingle();
    if (!settings?.owner_user_id) {
      throw new Error("scheduling_settings not initialised");
    }
    const ownerUserId = settings.owner_user_id as string;
    const tz = (settings.timezone as string) || "America/New_York";

    const [{ data: ruleRows }, { data: holRows }, { data: bookingRows }] =
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
      ]);

    const { normalizeWindowsFromRows, loadAllGoogleBusy } = await import(
      "./availability.server"
    );

    const windows = normalizeWindowsFromRows(
      (ruleRows ?? []) as Parameters<typeof normalizeWindowsFromRows>[0],
    );

    const holidays = (holRows ?? [])
      .filter((h: { is_observed: boolean | null }) => h.is_observed !== false)
      .map((h: { holiday_date: string }) => h.holiday_date);

    const googleBusy = await loadAllGoogleBusy(ownerUserId, fromMs, toMs);

    // Booked calls become busy too (so the dashboard is consistent with what
    // the public availability endpoint sees), but we ALSO surface them as
    // first-class items.
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
      ...googleBusy.map((b) => ({
        startUtc: new Date(b.startMs).toISOString(),
        endUtc: new Date(b.endMs).toISOString(),
      })),
      ...bookings.map((b) => ({ startUtc: b.startUtc, endUtc: b.endUtc })),
    ];

    return {
      ownerUserId,
      studioTimezone: tz,
      windows,
      holidays,
      busy,
      bookings,
    };
  });
