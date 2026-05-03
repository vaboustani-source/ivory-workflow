// Edge Function: notify-portrait-approval
// Sent when a couple approves their family portraits sequence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const firstName = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: client } = await admin.from("clients").select("couple_name_1, couple_name_2, manager_id, photographer_id").eq("id", client_id).maybeSingle();
    const subject = `${firstName(client?.couple_name_1)}${client?.couple_name_2 ? ` & ${firstName(client.couple_name_2)}` : ""} approved their family portraits`;

    // Best effort: log activity. Email send is wired to existing infra later.
    await admin.from("activity_log").insert({
      action_type: "portrait_sequence.approved",
      target_type: "client",
      target_id: client_id,
      description: subject,
    });

    console.log("[notify-portrait-approval]", subject);
    return new Response(JSON.stringify({ ok: true, subject }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
