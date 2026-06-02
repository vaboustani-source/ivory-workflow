// Owner-only diagnostic endpoint to verify the Postmark pipeline end-to-end.
// POST /api/admin/send-test-email
// Body: { to: string; subject?: string; body?: string }
// Returns: { success, messageId?, logId, error?, errorCode? }
//
// Stays in the codebase permanently as a diagnostic tool.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, POSTMARK_DEFAULTS } from "@/integrations/postmark/client.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/admin/send-test-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Authenticate caller via Bearer token
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return json({ error: "unauthorized" }, 401);
        }
        const token = authHeader.slice("Bearer ".length);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json({ error: "server_misconfigured" }, 500);
        }

        const authedClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: claimsErr } = await authedClient.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (claimsErr || !userId) {
          return json({ error: "unauthorized" }, 401);
        }

        // 2. Owner check via user_roles
        const { data: roleRow } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "owner")
          .maybeSingle();
        if (!roleRow) {
          return json({ error: "forbidden_owner_only" }, 403);
        }

        // 3. Parse body
        let parsed: { to?: string; subject?: string; body?: string } = {};
        try {
          parsed = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const to = (parsed.to ?? "").trim();
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          return json({ error: "invalid_recipient" }, 400);
        }
        const subject = parsed.subject?.trim() || "Postmark wiring test";
        const bodyText = parsed.body?.trim() || "Pipeline is live.";
        const htmlBody = `<p>${escapeHtml(bodyText)}</p>`;

        // 4. Send
        const result = await sendEmail({
          to,
          subject,
          htmlBody,
          textBody: bodyText,
          tag: "diagnostic-test",
          metadata: { source: "admin-send-test-email", triggered_by: userId },
        });

        // 5. Log to email_sends (always — sent or failed)
        const status = result.success
          ? "sent"
          : result.errorCode === "405" || /test mode|approved sender/i.test(result.error ?? "")
            ? "test_mode_blocked"
            : "failed";

        const { data: logRow, error: logErr } = await supabaseAdmin
          .from("email_sends")
          .insert({
            to_address: to,
            from_address: POSTMARK_DEFAULTS.from,
            reply_to: POSTMARK_DEFAULTS.replyTo,
            subject,
            template_key: "diagnostic_test",
            postmark_message_id: result.messageId ?? null,
            status,
            error_message: result.error ?? null,
            error_code: result.errorCode ?? null,
            tag: "diagnostic-test",
            metadata: { triggered_by: userId } as Record<string, unknown>,
            raw_response: (result.rawResponse ?? null) as Record<string, unknown> | null,
          } as never)
          .select("id")
          .single();
        if (logErr) {
          console.error("[send-test-email] failed to insert email_sends row", logErr);
        }

        return json(
          {
            success: result.success,
            status,
            messageId: result.messageId ?? null,
            logId: logRow?.id ?? null,
            error: result.error ?? null,
            errorCode: result.errorCode ?? null,
          },
          result.success ? 200 : 200, // 200 either way — caller inspects body
        );
      },
    },
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
