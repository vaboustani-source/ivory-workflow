// Edge Function: get-contractor-contract (public, no auth)
// Validates a public_token, returns the contract for signing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const contract_id = url.searchParams.get("contract_id");
    const token = url.searchParams.get("token");
    if (!contract_id || !token) return j({ error: "missing params" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("contracts").select("id, title, content, status, contract_kind, public_token, public_token_expires_at, counter_party_name, contractor_id, client_id").eq("id", contract_id).maybeSingle();
    if (!c || c.contract_kind !== "contractor") return j({ error: "not found" }, 404);
    if (c.public_token !== token) return j({ error: "invalid token" }, 403);
    if (c.public_token_expires_at && new Date(c.public_token_expires_at).getTime() < Date.now()) return j({ error: "token expired" }, 410);

    return j({
      ok: true,
      already_signed: c.status === "signed",
      contract: {
        id: c.id,
        title: c.title,
        content: c.content,
        counter_party_name: c.counter_party_name,
      },
    });
  } catch (e) {
    return j({ error: String((e as Error).message ?? e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
