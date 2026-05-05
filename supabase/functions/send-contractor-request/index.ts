// Edge Function: send-contractor-request
// Sends an availability inquiry email to a contractor. Studio-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    const callerId = u?.user?.id;
    if (!callerId) return j({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("role, full_name").eq("id", callerId).maybeSingle();
    if (!prof || !["owner", "studio_manager", "associate_photographer"].includes(prof.role)) {
      return j({ error: "forbidden" }, 403);
    }

    const { contractor_id, client_id, role, subject, body, agreed_distance_miles, agreed_minutes } = await req.json();
    if (!contractor_id || !client_id || !role) return j({ error: "missing fields" }, 400);

    const [{ data: contractor }, { data: client }] = await Promise.all([
      admin.from("contractors").select("*").eq("id", contractor_id).maybeSingle(),
      admin.from("clients").select("id, couple_name_1, couple_name_2, wedding_date, venue_name, venue_address").eq("id", client_id).maybeSingle(),
    ]);
    if (!contractor || !client) return j({ error: "not found" }, 404);
    if (!client.wedding_date) return j({ error: "client has no wedding_date" }, 400);

    const { data: inserted, error: insErr } = await admin.from("contractor_service_requests").insert({
      client_id,
      contractor_id,
      role,
      wedding_date: client.wedding_date,
      ceremony_address: client.venue_address,
      travel_distance_miles: agreed_distance_miles ?? null,
      travel_minutes: agreed_minutes ?? null,
      status: "sent",
      sent_by: callerId,
      notes: null,
    }).select("id").single();
    if (insErr) return j({ error: insErr.message }, 500);

    const send = await sendEmail({
      to: contractor.email,
      subject: subject || `Wedding availability inquiry`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;">${(body || "").replace(/\n/g, "<br/>")}</div>`,
      replyTo: prof.full_name ? undefined : undefined,
    });

    await admin.from("activity_log").insert({
      client_id,
      action_type: "service_request.sent",
      target_type: "contractor_service_request",
      target_id: inserted.id,
      description: `Sent service request to ${contractor.full_name} for ${role}`,
      is_client_visible: false,
      user_id: callerId,
    });

    return j({ ok: true, request_id: inserted.id, emailed: send.emailed, warn: send.warn ?? null });
  } catch (e) {
    return j({ error: String((e as Error).message ?? e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
