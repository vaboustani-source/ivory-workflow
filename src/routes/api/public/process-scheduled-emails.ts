// Generic scheduled-email processor.
//
// Called every minute by pg_cron via pg_net. Picks DUE rows from
// `scheduled_communications` (status='approved', scheduled_send_at <= now()),
// claims them atomically (FOR UPDATE SKIP LOCKED inside the
// `claim_due_scheduled_communications` RPC) so concurrent ticks never
// double-send, renders the already-drafted subject/body and dispatches via
// Postmark through the shared `sendEmail()` helper.
//
// Master gate: `studio_settings.scheduled_emails_enabled`. While false the
// processor returns early — nothing fires. Concrete email types (invoice
// reminders, overdue notices, workflow comms, …) will plug in later by
// drafting rows into this same queue.
//
// Auth: shared secret via `?secret=` query param OR `x-scheduled-emails-secret`
// header. Compared timing-safe against env `SCHEDULED_EMAILS_SECRET`.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, POSTMARK_DEFAULTS } from "@/integrations/postmark/client.server";
import type { Json, Tables, TablesInsert } from "@/integrations/supabase/types";

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 50;

type ScheduledComm = Tables<"scheduled_communications">;

interface ProcessorReport {
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
  total: number;
  details: Array<{
    id: string;
    outcome: "sent" | "failed" | "retrying" | "skipped";
    message?: string;
    postmark_id?: string | null;
  }>;
}

export const Route = createFileRoute("/api/public/process-scheduled-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ── Auth ───────────────────────────────────────────────────────
        const expected = process.env.SCHEDULED_EMAILS_SECRET;
        if (!expected) {
          console.error("[process-scheduled-emails] SCHEDULED_EMAILS_SECRET not configured");
          return json({ error: "server_misconfigured" }, 500);
        }
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-scheduled-emails-secret") ??
          url.searchParams.get("secret") ??
          "";
        if (!provided || !timingSafeEqual(provided, expected)) {
          return json({ error: "unauthorized" }, 401);
        }

        // ── Master gate ────────────────────────────────────────────────
        const { data: settings, error: settingsErr } = await supabaseAdmin
          .from("studio_settings")
          .select("scheduled_emails_enabled")
          .eq("is_active", true)
          .maybeSingle();
        if (settingsErr) {
          console.error("[process-scheduled-emails] settings load failed", settingsErr);
          return json({ error: "settings_load_failed" }, 500);
        }
        if (!settings?.scheduled_emails_enabled) {
          return json({ ok: true, gated: true, sent: 0, failed: 0, retrying: 0, skipped: 0, total: 0 });
        }

        // ── Claim DUE rows (atomic, SKIP LOCKED inside the RPC) ────────
        const { data: due, error: claimErr } = await supabaseAdmin.rpc(
          "claim_due_scheduled_communications" as never,
          { p_limit: BATCH_LIMIT } as never,
        );
        if (claimErr) {
          console.error("[process-scheduled-emails] claim failed", claimErr);
          return json({ error: "claim_failed", message: claimErr.message }, 500);
        }
        const rows = (due ?? []) as ScheduledComm[];

        const report: ProcessorReport = {
          sent: 0,
          failed: 0,
          retrying: 0,
          skipped: 0,
          total: rows.length,
          details: [],
        };

        for (const row of rows) {
          try {
            const result = await processOne(row);
            report[result.outcome] += 1;
            report.details.push({
              id: row.id,
              outcome: result.outcome,
              message: result.message,
              postmark_id: result.postmark_id ?? null,
            });
          } catch (e) {
            // Defensive: never let one bad row break the loop.
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[process-scheduled-emails] row threw", {
              id: row.id,
              error: msg,
            });
            await markRetryOrFail(row, `unhandled: ${msg}`);
            report.failed += 1;
            report.details.push({ id: row.id, outcome: "failed", message: msg });
          }
        }

        return json({ ok: true, ...report });
      },
    },
  },
});

interface OneResult {
  outcome: "sent" | "failed" | "retrying" | "skipped";
  message?: string;
  postmark_id?: string | null;
}

async function processOne(row: ScheduledComm): Promise<OneResult> {
  // Validate minimum send shape. Anything missing → skipped (not a retry —
  // the row is malformed and won't repair itself).
  const recipients = (row.recipient_emails ?? []).filter(
    (e): e is string => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
  );
  if (recipients.length === 0) {
    await markSkipped(row, "no valid recipient_emails");
    return { outcome: "skipped", message: "no valid recipient_emails" };
  }
  if (!row.subject || !row.body_draft) {
    await markSkipped(row, "missing subject or body_draft");
    return { outcome: "skipped", message: "missing subject or body_draft" };
  }

  // Render: this generic engine sends what was already drafted. Specific
  // email types (invoice reminder, overdue, workflow comms) will write
  // their rendered subject/body_draft into the row at draft/approve time.
  const subject = row.subject;
  const text = row.body_draft;
  const htmlBody = renderHtml(text);

  const sendResult = await sendEmail({
    to: recipients,
    subject,
    htmlBody,
    textBody: text,
    tag: "scheduled_communication",
    metadata: {
      scheduled_communication_id: row.id,
      client_id: row.client_id ?? "",
      workflow_step_id: row.workflow_step_id ?? "",
    },
  });

  const status: "sent" | "failed" | "test_mode_blocked" = sendResult.success
    ? "sent"
    : sendResult.errorCode === "405" ||
        /test mode|approved sender/i.test(sendResult.error ?? "")
      ? "test_mode_blocked"
      : "failed";

  // Log to email_sends regardless of outcome
  const logPayload: TablesInsert<"email_sends"> = {
    to_address: recipients.join(", "),
    from_address: POSTMARK_DEFAULTS.from,
    reply_to: POSTMARK_DEFAULTS.replyTo,
    subject,
    template_key: "scheduled_communication",
    client_id: row.client_id ?? null,
    postmark_message_id: sendResult.messageId ?? null,
    status,
    error_message: sendResult.error ?? null,
    error_code: sendResult.errorCode ?? null,
    tag: "scheduled_communication",
    metadata: {
      scheduled_communication_id: row.id,
      workflow_step_id: row.workflow_step_id,
      milestone_id: row.milestone_id,
      email_template_id: row.email_template_id,
      attempt: row.attempt_count, // already incremented by claim RPC
    } as Json,
    raw_response: (sendResult.rawResponse ?? null) as Json | null,
  };
  await supabaseAdmin.from("email_sends").insert(logPayload);

  if (status === "sent" || status === "test_mode_blocked") {
    await supabaseAdmin
      .from("scheduled_communications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: status === "test_mode_blocked" ? "Postmark test mode (treated as sent)" : null,
      })
      .eq("id", row.id);
    return { outcome: "sent", postmark_id: sendResult.messageId };
  }

  // Genuine failure — retry or give up
  const errMsg = sendResult.error ?? "unknown Postmark failure";
  const retried = await markRetryOrFail(row, errMsg);
  return {
    outcome: retried ? "retrying" : "failed",
    message: errMsg,
    postmark_id: sendResult.messageId ?? null,
  };
}

/** Returns true if the row is still retryable (status back to 'approved'). */
async function markRetryOrFail(row: ScheduledComm, errorMessage: string): Promise<boolean> {
  const attempts = row.attempt_count; // already bumped by claim RPC
  if (attempts < MAX_ATTEMPTS) {
    await supabaseAdmin
      .from("scheduled_communications")
      .update({ status: "approved", last_error: errorMessage })
      .eq("id", row.id);
    return true;
  }
  await supabaseAdmin
    .from("scheduled_communications")
    .update({ status: "failed" as never, last_error: errorMessage })
    .eq("id", row.id);
  return false;
}

async function markSkipped(row: ScheduledComm, reason: string) {
  await supabaseAdmin
    .from("scheduled_communications")
    .update({ status: "skipped", last_error: reason })
    .eq("id", row.id);
}

// ── helpers ────────────────────────────────────────────────────────────

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
