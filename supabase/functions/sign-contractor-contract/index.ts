// Edge Function: sign-contractor-contract (public, no auth)
// Validates token, records signature on the contract, and creates wedding_team row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { contract_id, token, typed_name, agreed_to_terms } = await req.json();
    if (!contract_id || !token || !typed_name) return j({ error: "missing fields" }, 400);
    if (!agreed_to_terms) return j({ error: "must agree to terms" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("contracts").select("*").eq("id", contract_id).maybeSingle();
    if (!c || c.contract_kind !== "contractor") return j({ error: "not found" }, 404);
    if (c.public_token !== token) return j({ error: "invalid token" }, 403);
    if (c.public_token_expires_at && new Date(c.public_token_expires_at).getTime() < Date.now()) return j({ error: "token expired" }, 410);
    if (c.status === "signed") return j({ error: "already signed" }, 409);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    const signatureData = {
      typed_name,
      signed_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: userAgent,
      counter_party_email: c.counter_party_email,
      counter_party_name: c.counter_party_name,
    };

    const { error: uErr } = await admin.from("contracts")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        signature_data: signatureData,
        public_token: null,
      })
      .eq("id", contract_id);
    if (uErr) return j({ error: uErr.message }, 500);

    // Find the related service request for this contract
    const { data: sr } = await admin.from("contractor_service_requests")
      .select("*").eq("contract_id", contract_id).maybeSingle();

    if (sr && c.contractor_id) {
      // Avoid dupes
      const { data: existing } = await admin.from("wedding_team")
        .select("id").eq("contract_id", contract_id).maybeSingle();
      if (!existing) {
        await admin.from("wedding_team").insert({
          client_id: c.client_id,
          contractor_id: c.contractor_id,
          role: sr.role,
          agreed_hourly_rate: sr.agreed_hourly_rate,
          agreed_hours: sr.agreed_hours,
          agreed_total: sr.agreed_total,
          contract_id: contract_id,
        });
      }
      await admin.from("contractor_service_requests")
        .update({ status: "booked" }).eq("id", sr.id);
    }

    await admin.from("activity_log").insert({
      client_id: c.client_id,
      action_type: "contract.contractor_signed",
      target_type: "contract",
      target_id: contract_id,
      description: `${c.counter_party_name ?? typed_name} signed the contractor contract`,
      client_facing_text: null,
      is_client_visible: false,
    });

    return j({ ok: true });
  } catch (e) {
    return j({ error: String((e as Error).message ?? e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
