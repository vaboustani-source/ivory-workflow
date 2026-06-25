// TEMP verification-only route (delete after use).
// Auth: ?secret=<SCHEDULED_EMAILS_SECRET>
// Returns: freeBusy success/count + availability overlap check.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/verify-google-busy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = url.searchParams.get("secret");
        if (!secret || secret !== process.env.SCHEDULED_EMAILS_SECRET) {
          return new Response("forbidden", { status: 403 });
        }
        const days = Number(url.searchParams.get("days") ?? "14");
        const ownerUserId =
          url.searchParams.get("owner") ?? "15f705ca-8003-467d-8b38-48b1795a6ba3";
        const slug = url.searchParams.get("slug") ?? "discovery";

        const fromMs = Date.now();
        const toMs = fromMs + days * 86_400_000;

        const {
          loadInputsForSlug,
          loadAllGoogleBusy,
          loadBookingBusy,
          generateSlots,
        } = await import("@/lib/scheduling/availability.server");

        let freeBusyError: string | null = null;
        let busy: Array<{ startMs: number; endMs: number }> = [];
        try {
          busy = await loadAllGoogleBusy(ownerUserId, fromMs, toMs);
        } catch (e) {
          freeBusyError = e instanceof Error ? e.message : String(e);
        }

        const loaded = await loadInputsForSlug(slug);
        let slotCount = 0;
        let overlaps: Array<{ slot: string; busy: string }> = [];
        let inWindowBusyCount = 0;
        if (loaded) {
          const bookingBusy = await loadBookingBusy(fromMs, toMs);
          const slots = generateSlots({
            durationMinutes: loaded.callType.duration_minutes,
            timezone: loaded.settings.timezone,
            bufferMinutes: loaded.settings.buffer_minutes,
            minLeadTimeHours: loaded.settings.min_lead_time_hours,
            lookaheadDays: loaded.settings.lookahead_days,
            windows: loaded.windows,
            holidays: loaded.holidays,
            busyIntervals: [...bookingBusy, ...busy],
            fromMs,
            toMs,
            nowMs: fromMs,
          });
          slotCount = slots.length;
          // Independent overlap check: build slots WITHOUT google busy, then
          // see which would-be-open slots get killed.
          const slotsNoGoogle = generateSlots({
            durationMinutes: loaded.callType.duration_minutes,
            timezone: loaded.settings.timezone,
            bufferMinutes: loaded.settings.buffer_minutes,
            minLeadTimeHours: loaded.settings.min_lead_time_hours,
            lookaheadDays: loaded.settings.lookahead_days,
            windows: loaded.windows,
            holidays: loaded.holidays,
            busyIntervals: bookingBusy,
            fromMs,
            toMs,
            nowMs: fromMs,
          });
          const finalSet = new Set(slots.map((s) => s.startUtc));
          const killed = slotsNoGoogle.filter((s) => !finalSet.has(s.startUtc));
          inWindowBusyCount = killed.length;
          // Verify NO returned slot overlaps any google busy interval
          for (const s of slots) {
            const sMs = Date.parse(s.startUtc);
            const eMs = Date.parse(s.endUtc);
            for (const b of busy) {
              if (sMs < b.endMs && eMs > b.startMs) {
                overlaps.push({
                  slot: `${s.startUtc}..${s.endUtc}`,
                  busy: `${new Date(b.startMs).toISOString()}..${new Date(b.endMs).toISOString()}`,
                });
                break;
              }
            }
          }
        }

        return Response.json({
          ownerUserId,
          rangeFrom: new Date(fromMs).toISOString(),
          rangeTo: new Date(toMs).toISOString(),
          freeBusy: {
            success: freeBusyError === null,
            error: freeBusyError,
            intervalCount: busy.length,
            sample: busy.slice(0, 8).map((b) => ({
              startUtc: new Date(b.startMs).toISOString(),
              endUtc: new Date(b.endMs).toISOString(),
            })),
          },
          availability: {
            slug,
            slotCount,
            slotsKilledByGoogleBusyInWindow: inWindowBusyCount,
            overlapCount: overlaps.length,
            overlapSample: overlaps.slice(0, 5),
          },
        });
      },
    },
  },
});
