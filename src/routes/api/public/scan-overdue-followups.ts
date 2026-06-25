// Daily scan that enqueues escalating "invoice overdue" follow-up emails
// into scheduled_communications. The Step-2 engine picks them up and sends.
//
// Cadence (capped — no nagging forever):
//   +3 days  past due → reminder_kind = 'overdue_3'
//   +10 days past due → reminder_kind = 'overdue_10'
//   +21 days past due → reminder_kind = 'overdue_21'   ← final auto-stage
//
// Gated by:
//   - studio_settings.overdue_followups_enabled  (per-type flag)
//   - studio_settings.scheduled_emails_enabled   (master gate; sends only)
//
// Idempotency: the unique partial index on
// scheduled_communications(invoice_id, reminder_kind) WHERE reminder_kind IS
// NOT NULL guarantees one row per (invoice, stage). Each scan picks the
// highest milestone the invoice has crossed and not yet been sent.
//
// Auth: shared secret via ?secret= or x-scheduled-emails-secret header
// (same secret used by /api/public/process-scheduled-emails and
// /api/public/scan-invoice-reminders).

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EMAIL_COPY_SCHEMAS } from "@/lib/email-copy-schemas";

// Ordered low → high so we can pick the latest milestone crossed
const MILESTONES: { days: number; kind: string }[] = [
  { days: 3, kind: "overdue_3" },
  { days: 10, kind: "overdue_10" },
  { days: 21, kind: "overdue_21" },
];
const ALL_KINDS = MILESTONES.map((m) => m.kind);

// Invoice statuses we consider open / dunnable. We deliberately INCLUDE
// 'overdue' (the app's auto-overdue status) and 'sent'/'viewed'/'scheduled'
// — anything not paid/cancelled/refunded/etc.
const OPEN_STATUSES = ["sent", "scheduled", "viewed", "overdue"] as const;

interface RecipientRow {
  email: string;
  view_token: string;
  role: string;
}

export const Route = createFileRoute("/api/public/scan-overdue-followups")({
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

        const { data: settings, error: settingsErr } = await supabaseAdmin
          .from("studio_settings")
          .select("overdue_followups_enabled, photographer_company")
          .eq("is_active", true)
          .maybeSingle();
        if (settingsErr) {
          console.error("[scan-overdue-followups] settings load failed", settingsErr);
          return json({ error: "settings_load_failed" }, 500);
        }
        if (!settings?.overdue_followups_enabled) {
          return json({ ok: true, gated: true, enqueued: 0, skipped: 0, considered: 0 });
        }
        const studioName = settings.photographer_company ?? "Stories by Victoria";

        const today = new Date();
        const minDue = isoDate(addDays(today, -365)); // safety floor
        const maxDue = isoDate(addDays(today, -MILESTONES[0].days)); // at least +3 past due

        const { data: invoices, error: invErr } = await supabaseAdmin
          .from("invoices")
          .select(
            "id, client_id, label, due_date, total_cents, status, paid_at",
          )
          .gte("due_date", minDue)
          .lte("due_date", maxDue)
          .is("paid_at", null)
          .in("status", OPEN_STATUSES as unknown as never[]);
        if (invErr) {
          console.error("[scan-overdue-followups] invoices load failed", invErr);
          return json({ error: "invoices_load_failed", message: invErr.message }, 500);
        }

        const candidates = (invoices ?? []).filter(
          (i) => i.client_id && i.due_date && (i.total_cents ?? 0) > 0,
        );

        // Load copy overrides once
        const { data: copyRow } = await supabaseAdmin
          .from("email_template_copy")
          .select("copy")
          .eq("email_type", "invoice_overdue")
          .maybeSingle();
        const overrides = (copyRow?.copy ?? {}) as Record<string, string>;
        const copy = resolveCopy(overrides);

        let enqueued = 0;
        let skipped = 0;
        const skips: Array<{ invoice_id: string; reason: string }> = [];

        for (const inv of candidates) {
          try {
            const daysOver = daysBetween(inv.due_date!, isoDate(today));
            const milestone = pickMilestone(daysOver);
            if (!milestone) {
              skipped += 1;
              skips.push({ invoice_id: inv.id, reason: `no_milestone_at_${daysOver}d` });
              continue;
            }

            // Skip if a row for THIS milestone already exists
            const { data: existing } = await supabaseAdmin
              .from("scheduled_communications")
              .select("id, reminder_kind")
              .eq("invoice_id", inv.id)
              .in("reminder_kind", ALL_KINDS)
              .limit(10);
            const sentKinds = new Set((existing ?? []).map((r) => r.reminder_kind));
            if (sentKinds.has(milestone.kind)) {
              skipped += 1;
              skips.push({ invoice_id: inv.id, reason: `already_${milestone.kind}` });
              continue;
            }

            // Held/pending change → skip entirely (B4 rule)
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
            const viewToken: string | null =
              recipientList.find((r) => r.role === "primary_client")?.view_token ??
              recipientList[0]?.view_token ??
              null;

            if (emails.length === 0) {
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
              invoice_label: inv.label ?? "your installment",
              amount_due: formatUsd(inv.total_cents ?? 0),
              due_date_long: formatLongDate(inv.due_date!),
              days_overdue: String(daysOver),
              pay_link: payLink,
            };

            const subject = applyPlaceholders(copy.subject, ctx);
            const heading = applyPlaceholders(copy.heading, ctx);
            const body1 = applyPlaceholders(copy.body_1, ctx);
            const body2 = applyPlaceholders(copy.body_2, ctx);
            const bodyDraft = `${heading}\n\n${body1}\n\n${body2}\n\n${copy.button_label}: ${payLink}`;

            const { error: insErr } = await supabaseAdmin
              .from("scheduled_communications")
              .insert({
                client_id: inv.client_id,
                invoice_id: inv.id,
                reminder_kind: milestone.kind,
                subject,
                body_draft: bodyDraft,
                status: "approved",
                scheduled_send_at: new Date().toISOString(),
                recipient_emails: emails,
              } as never);

            if (insErr) {
              if ((insErr as { code?: string }).code === "23505") {
                skipped += 1;
                skips.push({ invoice_id: inv.id, reason: `already_${milestone.kind}` });
                continue;
              }
              console.error("[scan-overdue-followups] enqueue failed", {
                invoice_id: inv.id,
                error: insErr,
              });
              skipped += 1;
              skips.push({ invoice_id: inv.id, reason: `insert_failed:${insErr.message}` });
              continue;
            }

            enqueued += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[scan-overdue-followups] row threw", { invoice_id: inv.id, error: msg });
            skipped += 1;
            skips.push({ invoice_id: inv.id, reason: `threw:${msg}` });
          }
        }

        return json({
          ok: true,
          considered: candidates.length,
          enqueued,
          skipped,
          window: { from: minDue, to: maxDue },
          skips,
        });
      },
    },
  },
});

// ── helpers ─────────────────────────────────────────────────────────────

/** Highest milestone the invoice has crossed; null if not yet at +3. */
function pickMilestone(daysOver: number): { days: number; kind: string } | null {
  let chosen: { days: number; kind: string } | null = null;
  for (const m of MILESTONES) {
    if (daysOver >= m.days) chosen = m;
  }
  return chosen;
}

function resolveCopy(overrides: Record<string, string>) {
  const schema = EMAIL_COPY_SCHEMAS.invoice_overdue;
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

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map((p) => parseInt(p, 10));
  const [ty, tm, td] = toIso.split("-").map((p) => parseInt(p, 10));
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000);
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
