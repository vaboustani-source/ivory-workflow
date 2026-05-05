// Edge Function: send-contractor-contract
// Studio creates a contract for a contractor, generates a single-use public token,
// and emails the contractor a public signing link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_PROJECT_ID = "e3bb35b0-f740-4259-80fa-567ec5c67321";
const PUBLIC_APP_URL = `https://project--${LOVABLE_PROJECT_ID}.lovable.app`;

function appBaseUrl(req: Request): string {
  const candidate = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!candidate) return PUBLIC_APP_URL;
  try {
    const { origin, hostname } = new URL(candidate);
    if (hostname.endsWith(".lovableproject.com") || hostname.startsWith("id-preview--") || hostname === "localhost") return PUBLIC_APP_URL;
    return origin;
  } catch { return PUBLIC_APP_URL; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    const callerId = u?.user?.id;
    if (!callerId) return j({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("role, full_name").eq("id", callerId).maybeSingle();
    if (!prof || !["owner", "studio_manager", "associate_photographer"].includes(prof.role)) return j({ error: "forbidden" }, 403);

    const { service_request_id, template_id, title, content } = await req.json();
    if (!service_request_id || !content || !title) return j({ error: "missing fields" }, 400);

    const { data: sr } = await admin.from("contractor_service_requests").select("*").eq("id", service_request_id).maybeSingle();
    if (!sr) return j({ error: "service request not found" }, 404);

    const { data: contractor } = await admin.from("contractors").select("*").eq("id", sr.contractor_id).maybeSingle();
    if (!contractor) return j({ error: "contractor not found" }, 404);

    const token = crypto.randomUUID() + "-" + crypto.randomUUID().split("-")[0];
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: contract, error: cErr } = await admin.from("contracts").insert({
      client_id: sr.client_id,
      title,
      content,
      template_id: template_id || null,
      status: "sent",
      sent_at: new Date().toISOString(),
      contract_kind: "contractor",
      counter_party_email: contractor.email,
      counter_party_name: contractor.full_name,
      contractor_id: contractor.id,
      public_token: token,
      public_token_expires_at: expiresAt,
      signature_required_role: "partner_1",
    }).select("id").single();
    if (cErr || !contract) return j({ error: cErr?.message ?? "create failed" }, 500);

    await admin.from("contractor_service_requests").update({ contract_id: contract.id }).eq("id", service_request_id);

    const link = `${appBaseUrl(req)}/sign/contract/${contract.id}?token=${token}`;
    const send = await sendEmail({
      to: contractor.email,
      subject: title,
      html: `
        <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;">
          <p>Hi ${contractor.full_name.split(" ")[0]},</p>
          <p>Please review and sign the contract for our upcoming wedding shoot. The link below is single-use and expires in 30 days.</p>
          <p><a href="${link}" style="background:#7a1f3d;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Review &amp; sign contract</a></p>
          <p style="color:#888;font-size:12px;">Or copy this link into your browser:<br/>${link}</p>
          <p>Thanks,<br/>${prof.full_name ?? "The Studio"}</p>
        </div>
      `,
    });

    await admin.from("activity_log").insert({
      client_id: sr.client_id,
      action_type: "contract.contractor_sent",
      target_type: "contract",
      target_id: contract.id,
      description: `Contract sent to ${contractor.full_name}`,
      is_client_visible: false,
      user_id: callerId,
    });

    return j({ ok: true, contract_id: contract.id, link, emailed: send.emailed });
  } catch (e) {
    return j({ error: String((e as Error).message ?? e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
