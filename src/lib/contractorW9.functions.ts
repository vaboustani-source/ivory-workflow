// Owner / studio_manager — manual "Send W-9 request" trigger.
// Creates the contractor_w9_requests row if needed, then POSTs to the
// internal /api/public/send-w9-request endpoint with the shared secret
// from Vault. The endpoint handles Postmark + email_sends + status flips
// + activity_log on success.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Input {
  contractorId: string;
  taxYear?: number;
  reminder?: boolean;
}

interface BulkInput {
  contractorIds: string[];
  taxYear?: number;
  reminder?: boolean;
}

async function assertStudio(supabase: any, userId: string) {
  const [{ data: ownerRow }, { data: mgrRow }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "studio_manager" }),
  ]);
  if (!ownerRow && !mgrRow) throw new Error("Forbidden");
  return { isOwner: !!ownerRow };
}

async function loadEndpoint(admin: any): Promise<{ url: string; secret: string }> {
  const [{ data: secret }, { data: url }] = await Promise.all([
    admin.rpc("get_internal_secret", { _name: "w9_request_shared_secret" }),
    admin.rpc("get_internal_secret", { _name: "w9_request_endpoint_url" }),
  ]);
  if (!secret || !url) throw new Error("W-9 webhook is not configured");
  return { url: url as string, secret: secret as string };
}

async function sendOne(
  url: string,
  secret: string,
  requestId: string,
  reminder: boolean,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-w9-secret": secret },
    body: JSON.stringify({ request_id: requestId, reminder }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.ok !== false, status: body?.status, body, http: res.status };
}

export const sendContractorW9Request = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    if (!input?.contractorId) throw new Error("Missing contractorId");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudio(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const taxYear = data.taxYear ?? new Date().getFullYear();

    const { data: ensured, error: ensureErr } = await supabaseAdmin.rpc(
      "ensure_contractor_w9_request",
      { _contractor_id: data.contractorId, _tax_year: taxYear, _created_by: userId },
    );
    if (ensureErr) throw new Error(ensureErr.message);
    const requestId = Array.isArray(ensured) ? ensured[0]?.request_id : (ensured as any)?.request_id;
    if (!requestId) throw new Error("Could not create W-9 request row");

    const { url, secret } = await loadEndpoint(supabaseAdmin);
    const r = await sendOne(url, secret, requestId, !!data.reminder);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status ?? `http_${r.http}`,
        error: r.body?.error ?? `HTTP ${r.http}`,
      };
    }
    return {
      ok: true,
      status: r.body?.status ?? "sent",
      messageId: r.body?.messageId ?? null,
      requestId,
    };
  });

export const sendContractorW9Bulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BulkInput) => {
    if (!Array.isArray(input?.contractorIds)) throw new Error("Missing contractorIds");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { isOwner } = await assertStudio(supabase, userId);
    if (!isOwner) throw new Error("Forbidden: owner only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const taxYear = data.taxYear ?? new Date().getFullYear();
    const reminder = data.reminder !== false; // default to reminder

    const { url, secret } = await loadEndpoint(supabaseAdmin);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const requestIds: string[] = [];

    for (const contractorId of data.contractorIds) {
      try {
        // Skip if already collected
        const { data: c } = await supabaseAdmin
          .from("contractors")
          .select("id, email, w9_collected")
          .eq("id", contractorId)
          .maybeSingle();
        if (!c || c.w9_collected || !c.email) {
          skipped++;
          continue;
        }
        const { data: ensured, error: ensureErr } = await supabaseAdmin.rpc(
          "ensure_contractor_w9_request",
          { _contractor_id: contractorId, _tax_year: taxYear, _created_by: userId },
        );
        if (ensureErr) {
          failed++;
          continue;
        }
        const requestId = Array.isArray(ensured)
          ? ensured[0]?.request_id
          : (ensured as any)?.request_id;
        if (!requestId) {
          failed++;
          continue;
        }
        const r = await sendOne(url, secret, requestId, reminder);
        if (r.ok) {
          sent++;
          requestIds.push(requestId);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Summary activity log (best-effort)
    try {
      await supabaseAdmin.from("activity_log").insert({
        action_type: "contractor_w9.bulk_reminder",
        target_type: "contractor_w9_request",
        target_id: null,
        description: `Sent ${sent} W-9 reminder${sent === 1 ? "" : "s"} (skipped ${skipped}, failed ${failed})`,
        user_id: userId,
        metadata: {
          tax_year: taxYear,
          reminder,
          sent,
          skipped,
          failed,
          request_ids: requestIds,
        } as any,
      });
    } catch { /* swallow */ }

    return { ok: true, sent, skipped, failed };
  });
