// Public booking endpoint (Slice 4).
//   POST /api/public/create-booking
// Body (JSON): {
//   call_type_id, starts_at (ISO), primary_email, couple_name_1,
//   couple_name_2?, phone?, custom_field_responses?, visitor_timezone,
//   idempotency_key?, hp? (honeypot)
// }
// Returns: { booking_id, cancel_token } | 409 SLOT_TAKEN | 4xx/5xx

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
          // Silently accept-but-don't-store the bot.
          return Response.json({ booking_id: "00000000-0000-0000-0000-000000000000", cancel_token: "00000000-0000-0000-0000-000000000000" });
        }

        const startsAtMs = Date.parse(b.starts_at);
        if (!Number.isFinite(startsAtMs)) return jsonError(400, "invalid_starts_at");

        const { data, error } = await supabaseAdmin.rpc("create_booking", {
          p_call_type_id: b.call_type_id,
          p_starts_at: new Date(startsAtMs).toISOString(),
          p_primary_email: b.primary_email,
          p_couple_name_1: b.couple_name_1,
          p_couple_name_2: b.couple_name_2 ?? null,
          p_phone: b.phone ?? null,
          p_custom_field_responses: b.custom_field_responses ?? {},
          p_visitor_timezone: b.visitor_timezone,
          p_idempotency_key: b.idempotency_key ?? null,
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

        return Response.json({
          booking_id: row.booking_id,
          cancel_token: row.cancel_token,
        });
      },
    },
  },
});
