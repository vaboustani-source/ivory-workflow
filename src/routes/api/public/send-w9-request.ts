// Internal webhook (called by the wedding_team trigger via pg_net AND by
// the owner-facing manual "Send W-9 request" server function).
//
// Auth: shared secret in `x-w9-secret` header, compared against the value
// stashed in Supabase Vault as `w9_request_shared_secret` (read via the
// service-role-only RPC `public.get_internal_secret`). No user JWT is
// required because pg_net cannot mint one.
//
// Behavior:
// - Loads the contractor_w9_requests row + contractor.
// - Idempotent: if status is already 'sent' or 'completed', returns 200 noop.
// - Renders the editable `Contractor — W-9 request` (or reminder) template
//   from email_templates, substituting {merge_fields}.
// - Calls Postmark via the shared sendEmail() helper.
// - Inserts an email_sends row (with contractor_id, template_key, status).
// - On success: updates the request to status='sent' + email_send_id.
// - On failure: status='failed', writes an owner notification + activity_log.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, POSTMARK_DEFAULTS } from "@/integrations/postmark/client.server";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/send-w9-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-w9-secret") ?? "";
        if (!provided) return json({ error: "missing_secret" }, 401);

        const { data: secret, error: secretErr } = await supabaseAdmin.rpc(
          "get_internal_secret",
          { _name: "w9_request_shared_secret" },
        );
        if (secretErr || !secret) {
          console.error("[send-w9-request] could not load internal secret", secretErr);
          return json({ error: "server_misconfigured" }, 500);
        }
        if (!timingSafeEqual(provided, secret as string)) {
          return json({ error: "forbidden" }, 403);
        }

        let body: { request_id?: string; reminder?: boolean } = {};
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const requestId = body.request_id;
        if (!requestId || typeof requestId !== "string") {
          return json({ error: "missing_request_id" }, 400);
        }
        const useReminder = body.reminder === true;
        const templateName = useReminder
          ? "Contractor — W-9 reminder"
          : "Contractor — W-9 request";
        const templateKey = useReminder ? "contractor_w9_reminder" : "contractor_w9_request";

        // Load request + contractor
        const { data: reqRow, error: reqErr } = await supabaseAdmin
          .from("contractor_w9_requests")
          .select("id, contractor_id, tax_year, status, email_send_id")
          .eq("id", requestId)
          .maybeSingle();
        if (reqErr || !reqRow) {
          return json({ error: "request_not_found" }, 404);
        }
        if (!useReminder && (reqRow.status === "sent" || reqRow.status === "completed")) {
          return json({ ok: true, skipped: "already_" + reqRow.status });
        }

        const { data: contractor, error: cErr } = await supabaseAdmin
          .from("contractors")
          .select("id, full_name, email, w9_collected")
          .eq("id", reqRow.contractor_id)
          .maybeSingle();
        if (cErr || !contractor) {
          return json({ error: "contractor_not_found" }, 404);
        }
        if (contractor.w9_collected) {
          return json({ ok: true, skipped: "already_collected" });
        }
        if (!contractor.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contractor.email)) {
          await markFailed(reqRow.id, contractor.id, "Contractor has no valid email on file.");
          return json({ error: "no_contractor_email" }, 400);
        }

        // Load editable template copy
        const { data: tmpl, error: tmplErr } = await supabaseAdmin
          .from("email_templates")
          .select("subject, body")
          .eq("name", templateName)
          .maybeSingle();
        if (tmplErr || !tmpl || !tmpl.subject || !tmpl.body) {
          await markFailed(reqRow.id, contractor.id, `Template "${templateName}" missing.`);
          return json({ error: "template_missing" }, 500);
        }
        const tmplSubject = tmpl.subject;
        const tmplBody = tmpl.body;

        const firstName = (contractor.full_name ?? "there").split(/\s+/)[0] || "there";
        const merge: Record<string, string> = {
          contractor_first_name: firstName,
          tax_year: String(reqRow.tax_year),
          studio_email: POSTMARK_DEFAULTS.replyTo,
          w9_form_url: "https://www.irs.gov/pub/irs-pdf/fw9.pdf",
          studio_signature: "Stories by Victoria",
        };
        const subject = applyMerge(tmpl.subject, merge);
        const text = applyMerge(tmpl.body, merge);
        const htmlBody = renderHtml(text);

        const sendResult = await sendEmail({
          to: contractor.email,
          subject,
          htmlBody,
          textBody: text,
          tag: templateKey,
          metadata: {
            contractor_id: contractor.id,
            request_id: reqRow.id,
            tax_year: String(reqRow.tax_year),
          },
        });

        const status = sendResult.success
          ? "sent"
          : sendResult.errorCode === "405" ||
              /test mode|approved sender/i.test(sendResult.error ?? "")
            ? "test_mode_blocked"
            : "failed";

        const logPayload: TablesInsert<"email_sends"> = {
          to_address: contractor.email,
          from_address: POSTMARK_DEFAULTS.from,
          reply_to: POSTMARK_DEFAULTS.replyTo,
          subject,
          template_key: templateKey,
          contractor_id: contractor.id,
          postmark_message_id: sendResult.messageId ?? null,
          status,
          error_message: sendResult.error ?? null,
          error_code: sendResult.errorCode ?? null,
          tag: templateKey,
          metadata: {
            request_id: reqRow.id,
            tax_year: reqRow.tax_year,
          } as Json,
          raw_response: (sendResult.rawResponse ?? null) as Json | null,
        };
        const { data: logRow } = await supabaseAdmin
          .from("email_sends")
          .insert(logPayload)
          .select("id")
          .single();

        if (status === "sent" || status === "test_mode_blocked") {
          await supabaseAdmin
            .from("contractor_w9_requests")
            .update({
              status: "sent",
              email_send_id: logRow?.id ?? null,
              requested_at: new Date().toISOString(),
            })
            .eq("id", reqRow.id);
          await supabaseAdmin
            .from("contractors")
            .update({ w9_requested_at: new Date().toISOString() })
            .eq("id", contractor.id);
        } else {
          await markFailed(
            reqRow.id,
            contractor.id,
            sendResult.error ?? "Unknown Postmark failure",
            logRow?.id ?? null,
          );
        }

        return json({
          ok: sendResult.success,
          status,
          messageId: sendResult.messageId ?? null,
          logId: logRow?.id ?? null,
          error: sendResult.error ?? null,
        });
      },
    },
  },
});

async function markFailed(
  requestId: string,
  contractorId: string,
  message: string,
  emailSendId: string | null = null,
) {
  await supabaseAdmin
    .from("contractor_w9_requests")
    .update({ status: "failed", email_send_id: emailSendId })
    .eq("id", requestId);

  // Notify every owner
  const { data: owners } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "owner");
  if (owners?.length) {
    const rows: TablesInsert<"notifications">[] = owners.map((o) => ({
      user_id: o.user_id,
      kind: "email_failed",
      title: "W-9 request email failed to send",
      body: message,
      link_to: "/studio/settings/contractors-tax",
    }));
    await supabaseAdmin.from("notifications").insert(rows);
  }

  await supabaseAdmin.from("activity_log").insert({
    action_type: "email_failed",
    target_type: "contractor_w9_request",
    target_id: requestId,
    description: `W-9 request email failed for contractor ${contractorId}: ${message}`,
    metadata: { contractor_id: contractorId, error: message } as Json,
  });
}

function applyMerge(input: string, vars: Record<string, string>): string {
  return input.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(text: string): string {
  const escaped = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>',
  );
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<div style="font-family:Georgia,serif;color:#222;line-height:1.55;font-size:15px;">${paragraphs}</div>`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
