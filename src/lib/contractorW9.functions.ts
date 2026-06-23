// Owner / studio_manager — manual "Send W-9 request" trigger.
// Creates the contractor_w9_requests row if needed, then POSTs to the
// internal /api/public/send-w9-request endpoint with the shared secret
// from Vault. The endpoint handles Postmark + email_sends + status flips.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Input {
  contractorId: string;
  taxYear?: number;
  reminder?: boolean;
}

export const sendContractorW9Request = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    if (!input?.contractorId) throw new Error("Missing contractorId");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Role check
    const [{ data: ownerRow }, { data: mgrRow }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "studio_manager" }),
    ]);
    if (!ownerRow && !mgrRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const taxYear = data.taxYear ?? new Date().getFullYear();

    // Ensure request row exists
    const { data: ensured, error: ensureErr } = await supabaseAdmin.rpc(
      "ensure_contractor_w9_request",
      { _contractor_id: data.contractorId, _tax_year: taxYear, _created_by: userId },
    );
    if (ensureErr) throw new Error(ensureErr.message);
    const requestId = Array.isArray(ensured) ? ensured[0]?.request_id : (ensured as any)?.request_id;
    if (!requestId) throw new Error("Could not create W-9 request row");

    // Pull secret + URL from vault
    const [{ data: secret }, { data: url }] = await Promise.all([
      supabaseAdmin.rpc("get_internal_secret", { _name: "w9_request_shared_secret" }),
      supabaseAdmin.rpc("get_internal_secret", { _name: "w9_request_endpoint_url" }),
    ]);
    if (!secret || !url) throw new Error("W-9 webhook is not configured");

    const res = await fetch(url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-w9-secret": secret as string,
      },
      body: JSON.stringify({ request_id: requestId, reminder: !!data.reminder }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) {
      return {
        ok: false,
        status: body?.status ?? `http_${res.status}`,
        error: body?.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      status: body.status ?? "sent",
      messageId: body.messageId ?? null,
      requestId,
    };
  });
