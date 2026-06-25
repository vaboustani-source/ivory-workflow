// Public booking endpoint (Slice 4 + Slice 5).
//   POST /api/public/create-booking
// Body (JSON): {
//   call_type_id, starts_at (ISO), primary_email, couple_name_1,
//   couple_name_2?, phone?, custom_field_responses?, visitor_timezone,
//   idempotency_key?, hp? (honeypot),
//   __test_force_zoom_fail?, __test_force_google_fail?  // dev/sandbox only
// }
// Returns: { booking_id, cancel_token, zoom_join_url }
//   | 409 SLOT_TAKEN
//   | 503 scheduling_unavailable  (compensated; slot freed)

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BookingProviderError,
  alertOwner,
  runBookingProviderFlow,
} from "@/lib/scheduling/booking-providers.server";

// Very simple per-IP rate limit (per Worker isolate; "best-effort, in-memory" per plan §9).
const HITS = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = HITS.get(ip);
  if (!bucket || bucket.resetAt < now) {
    HITS.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

const BodySchema = z.object({
  call_type_id: z.string().uuid(),
  starts_at: z.string().min(10),
  primary_email: z.string().trim().email().max(255),
  couple_name_1: z.string().trim().min(1).max(120),
  couple_name_2: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  custom_field_responses: z.record(z.string(), z.unknown()).optional(),
  visitor_timezone: z.string().min(1).max(80),
  idempotency_key: z.string().min(8).max(80).optional(),
  hp: z.string().optional(), // honeypot
  __test_force_zoom_fail: z.boolean().optional(),
  __test_force_google_fail: z.boolean().optional(),
});

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...(extra ?? {}) }, { status });
}

export const Route = createFileRoute("/api/public/create-booking")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (!rateLimit(ip)) return jsonError(429, "rate_limited");

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonError(400, "invalid_body");
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonError(400, "invalid_input", { issues: parsed.error.issues });
        }
        const b = parsed.data;
        if (b.hp && b.hp.length > 0) {
          return Response.json({
            booking_id: "00000000-0000-0000-0000-000000000000",
            cancel_token: "00000000-0000-0000-0000-000000000000",
            zoom_join_url: null,
          });
        }

        const startsAtMs = Date.parse(b.starts_at);
        if (!Number.isFinite(startsAtMs)) return jsonError(400, "invalid_starts_at");

        // ---- Step 1: atomic booking row creation (Slice 4) ----
        const { data, error } = await supabaseAdmin.rpc("create_booking", {
          p_call_type_id: b.call_type_id,
          p_starts_at: new Date(startsAtMs).toISOString(),
          p_primary_email: b.primary_email,
          p_couple_name_1: b.couple_name_1,
          p_couple_name_2: b.couple_name_2 ?? "",
          p_phone: b.phone ?? "",
          p_custom_field_responses: (b.custom_field_responses ?? {}) as never,
          p_visitor_timezone: b.visitor_timezone,
          p_idempotency_key: b.idempotency_key ?? undefined,
        });
        if (error) {
          const msg = error.message || "";
          if (/SLOT_TAKEN/.test(msg)) return jsonError(409, "SLOT_TAKEN");
          if (/CALL_TYPE_NOT_FOUND/.test(msg)) return jsonError(404, "call_type_not_found");
          console.error("[create-booking] rpc error:", error);
          return jsonError(500, "server_error");
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.booking_id) return jsonError(500, "no_row_returned");
        const bookingId = row.booking_id as string;
        const cancelToken = row.cancel_token as string;
        const endsAtIso = row.ends_at as string;
        const startsAtIso = row.starts_at as string;

        // Idempotency replay: if this booking already has zoom links, we're done.
        const { data: existing } = await supabaseAdmin
          .from("bookings")
          .select("zoom_join_url")
          .eq("id", bookingId)
          .maybeSingle();
        if (existing?.zoom_join_url) {
          return Response.json({
            booking_id: bookingId,
            cancel_token: cancelToken,
            zoom_join_url: existing.zoom_join_url,
          });
        }

        // ---- Step 2: load owner + call type + scheduling settings ----
        const [{ data: settings }, { data: callType }] = await Promise.all([
          supabaseAdmin
            .from("scheduling_settings")
            .select("owner_user_id, timezone, primary_calendar_id, booking_calendar_connection_id, booking_calendar_id")
            .limit(1)
            .maybeSingle(),
          supabaseAdmin
            .from("call_types")
            .select("name, duration_minutes")
            .eq("id", b.call_type_id)
            .maybeSingle(),
        ]);
        if (!settings?.owner_user_id || !callType) {
          await compensateBookingRow(bookingId);
          console.error("[create-booking] missing scheduling_settings or call_type");
          return jsonError(503, "scheduling_unavailable");
        }

        const ownerUserId = settings.owner_user_id as string;

        // Resolve which Google connection (and calendar within it) gets the
        // new event. Order:
        //   1. scheduling_settings.booking_calendar_connection_id (explicit)
        //   2. The single active Google connection (back-compat default)
        //   3. null → booking provider will error if multiple active Google
        let bookingConnectionId: string | null =
          (settings as { booking_calendar_connection_id?: string | null }).booking_calendar_connection_id ?? null;
        if (!bookingConnectionId) {
          const { data: activeGoogle } = await supabaseAdmin
            .from("calendar_connections")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("provider", "google")
            .eq("is_active", true);
          if ((activeGoogle ?? []).length === 1) {
            bookingConnectionId = activeGoogle![0].id as string;
          }
        }
        const bookingCalendarId =
          ((settings as { booking_calendar_id?: string | null }).booking_calendar_id ?? null) ||
          settings.primary_calendar_id ||
          "primary";

        // ---- Step 3: provider flow with compensation ----
        try {
          const providers = await runBookingProviderFlow(supabaseAdmin, {
            ownerUserId,
            primaryCalendarId: bookingCalendarId,
            bookingConnectionId,
            callTypeName: callType.name,
            startUtcIso: startsAtIso,
            endUtcIso: endsAtIso,
            durationMinutes: callType.duration_minutes,
            studioTimezone: settings.timezone || "America/New_York",
            primaryEmail: b.primary_email,
            coupleName1: b.couple_name_1,
            coupleName2: b.couple_name_2 ?? null,
            phone: b.phone ?? null,
            customFieldResponses: (b.custom_field_responses ?? {}) as Record<string, unknown>,
            __forceZoomFail: b.__test_force_zoom_fail,
            __forceGoogleFail: b.__test_force_google_fail,
          });

          // ---- Step 4: persist provider artifacts ----
          const { error: updErr } = await supabaseAdmin
            .from("bookings")
            .update({
              zoom_meeting_id: providers.zoom_meeting_id,
              zoom_join_url: providers.zoom_join_url,
              zoom_password: providers.zoom_password,
              google_calendar_event_id: providers.google_calendar_event_id,
              google_calendar_id: providers.google_calendar_id,
            })
            .eq("id", bookingId);
          if (updErr) {
            // Persist failed but provider artifacts exist — alert, don't compensate
            // (would orphan both Zoom + Google). Booking row still has slot.
            console.error("[create-booking] persist failure:", updErr);
            await alertOwner(supabaseAdmin, ownerUserId, {
              title: "Booking provider links failed to save",
              body: `Booking ${bookingId} created in Zoom (${providers.zoom_meeting_id}) and Google (${providers.google_calendar_event_id}) but the DB update failed: ${updErr.message}`,
              actionType: "scheduling.persist_failed",
              metadata: { bookingId, ...providers },
            });
            return jsonError(500, "server_error");
          }

          return Response.json({
            booking_id: bookingId,
            cancel_token: cancelToken,
            zoom_join_url: providers.zoom_join_url,
          });
        } catch (e) {
          await compensateBookingRow(bookingId);
          const err =
            e instanceof BookingProviderError
              ? e
              : new BookingProviderError({
                  provider: "zoom",
                  reason: "provider_error",
                  detail: e instanceof Error ? e.message : String(e),
                });
          console.error("[create-booking] provider flow failed:", err);
          await alertOwner(supabaseAdmin, ownerUserId, {
            title:
              err.reason === "no_connection"
                ? `Reconnect ${err.provider} to accept bookings`
                : err.reason === "token_revoked"
                ? `${err.provider} access was revoked — reconnect required`
                : `Booking failed at ${err.provider}`,
            body:
              `A couple tried to book a ${callType.name} on ${startsAtIso} but the ${err.provider} step failed and the booking was cancelled.\n\n` +
              `Reason: ${err.reason}\nDetail: ${err.detail}` +
              (err.orphanZoomMeetingId
                ? `\n\n⚠ Orphan Zoom meeting left behind: ${err.orphanZoomMeetingId} — please delete it manually.`
                : ""),
            actionType: `scheduling.${err.reason}`,
            metadata: {
              provider: err.provider,
              reason: err.reason,
              detail: err.detail,
              orphanZoomMeetingId: err.orphanZoomMeetingId,
              attemptedBookingId: bookingId,
              startsAt: startsAtIso,
            },
          });
          return jsonError(503, "scheduling_unavailable");
        }
      },
    },
  },
});

async function compensateBookingRow(bookingId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("bookings").delete().eq("id", bookingId);
  if (error) {
    console.error("[create-booking] compensation delete failed:", error, bookingId);
  }
}
