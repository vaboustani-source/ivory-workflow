// Notifies studio (Victoria + assigned manager/photographer) that a couple approved their portrait sequence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRole);

  try {
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const { client_id } = await req.json();
    if (!client_id) return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: corsHeaders });

    const { data: client } = await admin
      .from("clients")
      .select("couple_name_1, couple_name_2, manager_id, photographer_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client) return new Response(JSON.stringify({ error: "client_not_found" }), { status: 404, headers: corsHeaders });

    const ids = [client.manager_id, client.photographer_id].filter(Boolean) as string[];
    const { data: profs } = await admin.from("profiles").select("email, full_name").in("id", ids);
    const recipients = (profs ?? []).map((p) => p.email).filter(Boolean) as string[];
    const coupleName = `${client.couple_name_1}${client.couple_name_2 ? ` & ${client.couple_name_2}` : ""}`;
    const { data: approver } = await admin.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle();
    const approverName = approver?.full_name ?? "the couple";

    if (resendKey && recipients.length > 0) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Stories by Victoria <hello@storiesbyvictoria.com>",
          to: recipients,
          subject: `${coupleName} approved their portrait sequence`,
          html: `<p>${approverName} just approved the portrait sequence for <strong>${coupleName}</strong>.</p><p>You can review it in the studio dashboard.</p>`,
        }),
      });
    }

    await admin.from("activity_log").insert({
      action_type: "portrait_sequence_approved",
      target_type: "client",
      target_id: client_id,
      description: `Portrait sequence approved by ${approverName}`,
      user_id: u.user.id,
      metadata: {},
    });

    return new Response(JSON.stringify({ ok: true, emailed: recipients.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
