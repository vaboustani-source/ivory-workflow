// Supabase Edge Function: send-portal-invite
// Creates a portal_invitations row and emails the invitee a magic link to /portal/welcome.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const origin = req.headers.get("origin") ?? req.headers.get("referer")?.replace(/\/$/, "") ?? "";
    const baseUrl = origin && origin !== "null"
      ? origin.replace(/\/$/, "")
      : `https://project--${Deno.env.get("SUPABASE_URL")?.split("//")[1]?.split(".")[0] ?? ""}.lovable.app`;
    const link = `${baseUrl}/portal/welcome?token=${token}`;

    const coupleNames = client.couple_name_1
      + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");
    const subject = invitation_type === "partner"
      ? "Your partner invited you to your wedding portal — Stories by Victoria"
      : "Welcome to your wedding portal — Stories by Victoria";
    const greeting = invitation_type === "partner"
      ? `Join your partner on this journey.`
      : `Welcome to your story.`;
    const intro = invitation_type === "partner"
      ? `You've been invited to join the wedding portal for <em>${coupleNames}</em>. We've prepared a quiet, beautiful space to walk through every step of your photography journey together.`
      : `We're so glad you're here. We've prepared a quiet, beautiful space for you to walk through your wedding photography journey with us — every milestone, every detail, every memory.`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F5EDE6;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EDE6;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:8px;box-shadow:0 4px 16px rgba(42,26,31,0.06);">
        <tr><td align="center" style="padding:32px 32px 8px;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#B8924A;font-size:32px;letter-spacing:2px;">SBV</div>
        </td></tr>
        <tr><td align="center" style="padding:0 40px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:400;color:#6B1F2A;font-size:28px;line-height:1.3;margin:16px 0 8px;">${greeting}</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 24px;">
          <p style="font-family:'Inter',Arial,sans-serif;color:#2A1A1F;font-size:15px;line-height:1.6;margin:0;">${intro}</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 40px 32px;">
          <a href="${link}" style="display:inline-block;background:#6B1F2A;color:#F5EDE6;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:500;letter-spacing:0.5px;padding:14px 32px;border-radius:4px;">Open your portal</a>
        </td></tr>
        <tr><td style="padding:0 40px 24px;">
          <p style="font-family:'Inter',Arial,sans-serif;color:#7A6A6E;font-size:12px;line-height:1.5;margin:0;text-align:center;">This link expires in 7 days. If you didn't expect this invitation, please ignore this email.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #E8DAD9;padding:24px 40px;">
          <p style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#6B1F2A;font-size:14px;margin:0;">with care,<br/>Stories by Victoria</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
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
        // Don't fail the whole flow — invitation row exists, link can be shared manually.
        return new Response(JSON.stringify({ ok: true, emailed: false, link, warn: "email_failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.warn("RESEND_API_KEY missing; skipping email send");
      return new Response(JSON.stringify({ ok: true, emailed: false, link, warn: "no_resend_key" }), {
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
