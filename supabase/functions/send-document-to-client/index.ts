// Supabase Edge Function: send-document-to-client
// Sends a contract or questionnaire notification email to the couple via Resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_PROJECT_ID = "e3bb35b0-f740-4259-80fa-567ec5c67321";
const PUBLIC_APP_URL = `https://project--${LOVABLE_PROJECT_ID}.lovable.app`;

function getPortalBaseUrl(req: Request): string {
  const candidate = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!candidate || candidate === "null") return PUBLIC_APP_URL;
  try {
    const { origin, hostname } = new URL(candidate);
    const isEditorPreview = hostname.endsWith(".lovableproject.com") || hostname.startsWith("id-preview--");
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isEditorPreview || isLocalhost) return PUBLIC_APP_URL;
    return origin;
  } catch {
    return PUBLIC_APP_URL;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id ?? null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: callerProfile } = await admin
      .from("profiles").select("role, full_name").eq("id", callerId).maybeSingle();
    const studioRoles = ["owner", "studio_manager", "associate_photographer"];
    if (!callerProfile || !studioRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { type, document_id, client_id, personal_note } = body as {
      type: "contract" | "questionnaire";
      document_id: string;
      client_id: string;
      personal_note?: string;
    };
    if (!type || !document_id || !client_id) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: client } = await admin
      .from("clients")
      .select("id, couple_name_1, couple_name_2, primary_email, secondary_email, manager_id, photographer_id")
      .eq("id", client_id).maybeSingle();
    if (!client) {
      return new Response(JSON.stringify({ error: "client not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (callerProfile.role !== "owner" && client.manager_id !== callerId && client.photographer_id !== callerId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipient = (client.primary_email ?? "").trim();
    if (!recipient) {
      return new Response(JSON.stringify({ error: "no recipient email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = getPortalBaseUrl(req);
    const portalPath = type === "contract"
      ? `/portal/documents?contract_id=${document_id}`
      : `/portal/questionnaires?questionnaire_id=${document_id}`;
    const link = `${baseUrl}${portalPath}`;

    const subject = type === "contract"
      ? "Your contract is ready — Stories by Victoria"
      : "We have a few questions for you — Stories by Victoria";
    const greeting = `Hi ${client.couple_name_1},`;
    const intro = type === "contract"
      ? `Your wedding photography contract is ready to review and sign. Take your time — we're here whenever you have questions.`
      : `When you have a moment, would you mind answering a few questions? It helps us prepare for your day.`;

    const noteHtml = personal_note
      ? `<tr><td style="padding:0 40px 16px;"><div style="border-left:2px solid #B8924A;padding:8px 16px;background:#F5EDE6;"><p style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#2A1A1F;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${personal_note.replace(/</g, "&lt;")}</p></div></td></tr>`
      : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F5EDE6;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EDE6;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:8px;box-shadow:0 4px 16px rgba(42,26,31,0.06);">
        <tr><td align="center" style="padding:32px 32px 8px;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#B8924A;font-size:32px;letter-spacing:2px;">SBV</div>
        </td></tr>
        <tr><td style="padding:16px 40px 8px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:400;color:#6B1F2A;font-size:26px;line-height:1.3;margin:0;">${greeting}</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 16px;">
          <p style="font-family:'Inter',Arial,sans-serif;color:#2A1A1F;font-size:15px;line-height:1.6;margin:0;">${intro}</p>
        </td></tr>
        ${noteHtml}
        <tr><td align="center" style="padding:8px 40px 32px;">
          <a href="${link}" style="display:inline-block;background:#6B1F2A;color:#F5EDE6;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:500;letter-spacing:0.5px;padding:14px 32px;border-radius:4px;">Open in your portal</a>
        </td></tr>
        <tr><td style="border-top:1px solid #E8DAD9;padding:24px 40px;">
          <p style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#6B1F2A;font-size:14px;margin:0;">with care,<br/>Stories by Victoria</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await admin.from("activity_log").insert({
      user_id: callerId,
      action_type: type === "contract" ? "contract.sent" : "questionnaire.sent",
      target_type: type,
      target_id: document_id,
      description: `${type === "contract" ? "Contract" : "Questionnaire"} sent to ${recipient}`,
      metadata: { recipient, client_id, has_note: !!personal_note },
    });

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY missing; skipping email send");
      return new Response(JSON.stringify({ ok: true, emailed: false, link, warn: "no_resend_key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Stories by Victoria <hello@mail.victoriaboustani.com>",
        to: [recipient],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("resend send failed", r.status, errText);
      return new Response(JSON.stringify({ ok: true, emailed: false, link, warn: "email_failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, emailed: true, link }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-document-to-client error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
