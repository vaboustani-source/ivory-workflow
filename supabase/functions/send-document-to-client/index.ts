// Supabase Edge Function: send-document-to-client
// Sends a contract or questionnaire notification email to the couple via Resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";
import { buildContractSent, buildFormSent } from "../_emails/renderers.ts";
import { loadCopyOverrides } from "../_emails/load_overrides.ts";

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
      ? `Your contract is ready — ${BRAND.studioName}`
      : `We have a few questions for you — ${BRAND.studioName}`;
    const intro = type === "contract"
      ? `Your wedding photography contract is ready to review and sign. Take your time — we're here whenever you have questions.`
      : `When you have a moment, would you mind answering a few questions? It helps us prepare for your day.`;
    const ctaLabel = type === "contract" ? "Review & sign" : "Open form";

    const noteHtml = personal_note
      ? noteBlock(escapeHtml(personal_note).replace(/\n/g, "<br/>"))
      : "";

    const contentHtml = `
      ${heading(`Hi ${client.couple_name_1},`)}
      ${paragraph(intro)}
      ${noteHtml}
      ${button(ctaLabel, link)}
    `;

    const html = renderEmailTemplate({
      preheader: intro.slice(0, 100),
      contentHtml,
    });

    await admin.from("activity_log").insert({
      user_id: callerId,
      action_type: type === "contract" ? "contract.sent" : "questionnaire.sent",
      target_type: type,
      target_id: document_id,
      description: `${type === "contract" ? "Contract" : "Questionnaire"} sent to ${recipient}`,
      metadata: { recipient, client_id, has_note: !!personal_note },
    });

    const sendResult = await sendEmail({ to: recipient, subject, html });
    if (!sendResult.emailed) {
      return new Response(JSON.stringify({ ok: true, emailed: false, link, warn: sendResult.warn }), {
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
