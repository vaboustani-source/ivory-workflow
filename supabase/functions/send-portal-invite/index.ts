// Supabase Edge Function: send-portal-invite
// Creates a portal_invitations row and emails the invitee a magic link to /portal/welcome.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";
import { buildPortalInvite } from "../_emails/renderers.ts";
import { loadCopyOverrides } from "../_emails/load_overrides.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_PROJECT_ID = "e3bb35b0-f740-4259-80fa-567ec5c67321";
const PUBLIC_APP_URL = "https://studio.victoriaboustani.com";


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

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

    // Check caller is studio user
    const { data: callerProfile } = await admin
      .from("profiles").select("role, full_name").eq("id", callerId).maybeSingle();
    const studioRoles = ["owner", "studio_manager", "associate_photographer"];
    if (!callerProfile || !studioRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { client_id, invitation_type = "initial", invited_email, invited_role_in_couple = "partner_2" } = body;
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), {
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

    // Authorization for non-owners: must be assigned
    if (callerProfile.role !== "owner") {
      if (client.manager_id !== callerId && client.photographer_id !== callerId) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Determine recipient email
    const recipient = (invited_email ?? client.primary_email ?? "").trim();
    if (!recipient) {
      return new Response(JSON.stringify({ error: "no recipient email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: invErr } = await admin.from("portal_invitations").insert({
      client_id,
      invited_email: recipient,
      invited_by: callerId,
      invitation_token: token,
      expires_at: expiresAt,
      invitation_type,
      invited_role_in_couple,
    });
    if (invErr) {
      console.error("invitation insert failed", invErr);
      return new Response(JSON.stringify({ error: invErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update clients.portal_invited_at + log
    if (invitation_type === "initial" || invitation_type === "resend") {
      await admin.from("clients").update({ portal_invited_at: new Date().toISOString() }).eq("id", client_id);
    }
    if (invitation_type === "partner") {
      await admin.from("client_users")
        .update({ partner_email: recipient, partner_invited_at: new Date().toISOString() })
        .eq("client_id", client_id)
        .eq("user_id", callerId === null ? "00000000-0000-0000-0000-000000000000" : callerId);
    }
    await admin.from("activity_log").insert({
      user_id: callerId,
      action_type: invitation_type === "partner" ? "portal.partner_invite_sent" : "portal.invite_sent",
      target_type: "client",
      target_id: client_id,
      description: `Portal invite (${invitation_type}) sent to ${recipient}`,
      metadata: { recipient, invitation_type },
    });

    // Build URL
    const baseUrl = getPortalBaseUrl(req);
    const link = `${baseUrl}/portal/welcome?token=${token}`;

    const coupleNames = client.couple_name_1
      + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");
    const variant: "initial" | "resend" | "partner" =
      invitation_type === "partner" ? "partner" : invitation_type === "resend" ? "resend" : "initial";

    const overrides = await loadCopyOverrides(admin, "portal_invite");
    const ctx: Record<string, string> = {
      couple_first_names: client.couple_name_1,
      couple_full_names: coupleNames,
      studio_name: BRAND.studioName,
    };

    const { subject, html } = buildPortalInvite(overrides, ctx, {
      link,
      variant,
      partnerCoupleNames: coupleNames,
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
    console.error("send-portal-invite error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
