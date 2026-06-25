// Public availability endpoint (Slice 3).
//   GET /api/public/availability?slug=<call-type-slug>&from=<iso>&to=<iso>[&tz=<iana>]
// Returns: { studioTimezone, callType: {slug,name,durationMinutes}, slots: [{startUtc,endUtc}] }
//
// Public, read-only. Calls the availability engine through supabaseAdmin only
// (server-side); never returns raw rows. Range is clamped to scheduling
// lookahead. 404 if the call type is missing or inactive.

import { createFileRoute } from "@tanstack/react-router";

const MAX_RANGE_DAYS = 120;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/availability")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
        const fromStr = url.searchParams.get("from");
        const toStr = url.searchParams.get("to");
        if (!slug) return jsonError(400, "slug required");
        if (!fromStr || !toStr) return jsonError(400, "from and to required (ISO)");

        const fromMs = Date.parse(fromStr);
        const toMs = Date.parse(toStr);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
          return jsonError(400, "from/to must be ISO 8601");
        }
        if (toMs <= fromMs) return jsonError(400, "to must be after from");
        if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
          return jsonError(400, `range exceeds ${MAX_RANGE_DAYS} days`);
        }

        const {
          loadInputsForSlug,
          loadBookingBusy,
          loadAllGoogleBusy,
          generateSlots,
        } = await import("@/lib/scheduling/availability.server");

        const loaded = await loadInputsForSlug(slug);
        if (!loaded) return jsonError(404, "call type not found");

        const { callType, ownerUserId, settings, windows, holidays } = loaded;
        const nowMs = Date.now();
        const horizon = nowMs + settings.lookahead_days * 86_400_000;
        const clampedTo = Math.min(toMs, horizon);

        // Busy intervals come from:
        //   - Confirmed in-app bookings
        //   - UNION of free/busy across ALL active Google connections for the
        //     owner (multi-account). Each connection contributes its own
        //     busy_calendar_ids (default ['primary']).
        // scheduling_settings.primary_calendar_id / also_busy_from_calendar_ids
        // are no longer read here — busy_calendar_ids on each connection is
        // now the source of truth.
        const [bookingBusy, googleBusy] = await Promise.all([
          loadBookingBusy(fromMs, clampedTo),
          loadAllGoogleBusy(ownerUserId, fromMs, clampedTo),
        ]);

        const slots = generateSlots({
          durationMinutes: callType.duration_minutes,
          timezone: settings.timezone,
          bufferMinutes: settings.buffer_minutes,
          minLeadTimeHours: settings.min_lead_time_hours,
          lookaheadDays: settings.lookahead_days,
          windows,
          holidays,
          busyIntervals: [...bookingBusy, ...googleBusy],
          fromMs,
          toMs: clampedTo,
          nowMs,
        });

        return Response.json({
          studioTimezone: settings.timezone,
          callType: {
            slug: callType.slug,
            name: callType.name,
            durationMinutes: callType.duration_minutes,
          },
          slots,
        });
      },
    },
  },
});
