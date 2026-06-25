// Daily scan that enqueues "invoice due in ~7 days" reminder emails into the
// scheduled_communications queue. The Step-2 engine picks them up and sends.
//
// Gated by:
//   - studio_settings.invoice_reminders_enabled (per-type flag)
//   - studio_settings.scheduled_emails_enabled  (master gate; sends only)
//
// Idempotency: a unique partial index on
// scheduled_communications(invoice_id, reminder_kind) WHERE reminder_kind IS
// NOT NULL prevents enqueuing the same reminder twice for the same invoice.
//
// Auth: shared secret via ?secret= or x-scheduled-emails-secret header
// (same secret used by /api/public/process-scheduled-emails).

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EMAIL_COPY_SCHEMAS } from "@/lib/email-copy-schemas";

const REMINDER_KIND = "invoice_due_7d";
const LEAD_DAYS_MIN = 6;
const LEAD_DAYS_MAX = 8;

// Invoice statuses that count as "open / awaiting payment"
const OPEN_STATUSES = ["sent", "scheduled", "viewed", "overdue"] as const;

interface RecipientRow {
  email: string;
  view_token: string;
  role: string;
}

export const Route = createFileRoute("/api/public/scan-invoice-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SCHEDULED_EMAILS_SECRET;
        if (!expected) return json({ error: "server_misconfigured" }, 500);
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-scheduled-emails-secret") ??
          url.searchParams.get("secret") ??
          "";
        if (!provided || !timingSafeEqual(provided, expected)) {
          return json({ error: "unauthorized" }, 401);
        }

        // Per-type gate
        const { data: settings, error: settingsErr } = await supabaseAdmin
          .from("studio_settings")
          .select("invoice_reminders_enabled, photographer_company")
          .eq("is_active", true)
          .maybeSingle();
        if (settingsErr) {
          console.error("[scan-invoice-reminders] settings load failed", settingsErr);
          return json({ error: "settings_load_failed" }, 500);
        }
        if (!settings?.invoice_reminders_enabled) {
          return json({ ok: true, gated: true, enqueued: 0, skipped: 0, considered: 0 });
        }
        const studioName = settings.photographer_company ?? "Stories by Victoria";

        // Date window: due_date in [today+6, today+8]
        const today = new Date();
        const windowStart = isoDate(addDays(today, LEAD_DAYS_MIN));
        const windowEnd = isoDate(addDays(today, LEAD_DAYS_MAX));

        const { data: invoices, error: invErr } = await supabaseAdmin
          .from("invoices")
          .select(
            "id, client_id, label, due_date, total_cents, status, invoice_type, paid_at",
          )
          .gte("due_date", windowStart)
          .lte("due_date", windowEnd)
          .is("paid_at", null)
          .in("status", OPEN_STATUSES as unknown as never[]);
        if (invErr) {
          console.error("[scan-invoice-reminders] invoices load failed", invErr);
          return json({ error: "invoices_load_failed", message: invErr.message }, 500);
        }

        const candidates = (invoices ?? []).filter(
          (i) => i.client_id && i.due_date && (i.total_cents ?? 0) > 0,
        );

        // Load copy overrides once
        const { data: copyRow } = await supabaseAdmin
          .from("email_template_copy")
          .select("copy")
          .eq("email_type", "invoice_reminder")
          .maybeSingle();
        const overrides = (copyRow?.copy ?? {}) as Record<string, string>;
        const copy = resolveCopy(overrides);

        let enqueued = 0;
        let skipped = 0;
        const skips: Array<{ invoice_id: string; reason: string }> = [];

        for (const inv of candidates) {
          try {
            // Skip if client has any pending pending_changes (B4 dunning rule)
            const { data: pending } = await supabaseAdmin
              .from("pending_changes")
              .select("id")
              .eq("client_id", inv.client_id!)
              .eq("status", "pending")
              .limit(1);
            if ((pending?.length ?? 0) > 0) {
              skipped += 1;
              skips.push({ invoice_id: inv.id, reason: "client_has_pending_change" });
              continue;
            }

            // Recipients + pay-page view_token
            const { data: recipients } = await supabaseAdmin
              .from("invoice_recipients")
              .select("email, view_token, role")
              .eq("invoice_id", inv.id);

            const recipientList: RecipientRow[] = (recipients ?? [])
              .filter((r) => !!r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
              .map((r) => ({ email: r.email, view_token: r.view_token, role: String(r.role) }));

            let emails: string[] = recipientList.map((r) => r.email);
            let viewToken: string | null =
              recipientList.find((r) => r.role === "primary_client")?.view_token ??
              recipientList[0]?.view_token ??
              null;

            if (emails.length === 0) {
              // Fallback: pull from clients
              const { data: clientRow } = await supabaseAdmin
                .from("clients")
                .select("primary_email, secondary_email")
                .eq("id", inv.client_id!)
                .maybeSingle();
              if (clientRow?.primary_email) emails.push(clientRow.primary_email);
              if (clientRow?.secondary_email) emails.push(clientRow.secondary_email);
            }
            emails = Array.from(
              new Set(emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))),
            );

            if (emails.length === 0 || !viewToken) {
              skipped += 1;
              skips.push({
                invoice_id: inv.id,
                reason: emails.length === 0 ? "no_recipient_email" : "no_view_token",
              });
              continue;
            }

            // Render copy
            const { data: clientName } = await supabaseAdmin
              .from("clients")
              .select("couple_name_1, couple_name_2")
              .eq("id", inv.client_id!)
              .maybeSingle();
            const firstNames = formatFirstNames(
              clientName?.couple_name_1 ?? null,
              clientName?.couple_name_2 ?? null,
            );
            const fullNames = formatFullNames(
              clientName?.couple_name_1 ?? null,
              clientName?.couple_name_2 ?? null,
            );
            const payLink = `https://studio.victoriaboustani.com/pay/${viewToken}`;
            const ctx: Record<string, string> = {
              couple_first_names: firstNames,
              couple_full_names: fullNames,
              studio_name: studioName,
              invoice_label: inv.label ?? "your next installment",
              amount_due: formatUsd(inv.total_cents ?? 0),
              due_date_long: formatLongDate(inv.due_date!),
              pay_link: payLink,
            };

            const subject = applyPlaceholders(copy.subject, ctx);
            const heading = applyPlaceholders(copy.heading, ctx);
            const body1 = applyPlaceholders(copy.body_1, ctx);
            const body2 = applyPlaceholders(copy.body_2, ctx);
            const bodyDraft = `${heading}\n\n${body1}\n\n${body2}\n\n${copy.button_label}: ${payLink}`;

            // Idempotent enqueue — relies on the unique partial index
            // (invoice_id, reminder_kind) WHERE reminder_kind IS NOT NULL.
            const { error: insErr } = await supabaseAdmin
              .from("scheduled_communications")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .insert({
                client_id: inv.client_id,
                invoice_id: inv.id,
                reminder_kind: REMINDER_KIND,
                subject,
                body_draft: bodyDraft,
                status: "approved",
                scheduled_send_at: new Date().toISOString(),
                recipient_emails: emails,
              } as never);

            if (insErr) {
              // Unique-violation = already enqueued (idempotent path, not an error)
              if ((insErr as { code?: string }).code === "23505") {
                skipped += 1;
                skips.push({ invoice_id: inv.id, reason: "already_enqueued" });
                continue;
              }
              console.error(
                "[scan-invoice-reminders] enqueue failed",
                { invoice_id: inv.id, error: insErr },
              );
              skipped += 1;
              skips.push({ invoice_id: inv.id, reason: `insert_failed:${insErr.message}` });
              continue;
            }

            enqueued += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[scan-invoice-reminders] row threw", { invoice_id: inv.id, error: msg });
            skipped += 1;
            skips.push({ invoice_id: inv.id, reason: `threw:${msg}` });
          }
        }

        return json({
          ok: true,
          considered: candidates.length,
          enqueued,
          skipped,
          window: { from: windowStart, to: windowEnd },
          skips,
        });
      },
    },
  },
});

// ── helpers ─────────────────────────────────────────────────────────────

function resolveCopy(overrides: Record<string, string>) {
  const schema = EMAIL_COPY_SCHEMAS.invoice_reminder;
  const out: Record<string, string> = {};
  for (const f of schema.fields) {
    const v = overrides[f.key];
    out[f.key] = typeof v === "string" && v.trim().length > 0 ? v : f.defaultValue;
  }
  return out as {
    subject: string;
    heading: string;
    body_1: string;
    body_2: string;
    button_label: string;
  };
}

function applyPlaceholders(s: string, ctx: Record<string, string>): string {
  return s.replace(/\{([a-z_]+)\}/g, (_, k: string) => ctx[k] ?? `{${k}}`);
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLongDate(iso: string): string {
  // YYYY-MM-DD -> "September 12, 2026"
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function firstWord(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

function formatFirstNames(n1: string | null, n2: string | null): string {
  const a = firstWord(n1);
  const b = firstWord(n2);
  if (a && b) return `${a} and ${b}`;
  return a ?? b ?? "there";
}

function formatFullNames(n1: string | null, n2: string | null): string {
  const a = (n1 ?? "").trim();
  const b = (n2 ?? "").trim();
  if (a && b) return `${a} and ${b}`;
  return a || b || "there";
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
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
