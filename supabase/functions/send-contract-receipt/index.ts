// Supabase Edge Function: send-contract-receipt
// Emails the couple a confirmation that their contract has been signed,
// including signature audit details (typed name, IP, timestamp).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { renderEmailTemplate } from "../_emails/template.ts";
import { heading, paragraph, divider, smallLabel, detailRow } from "../_emails/components.ts";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";

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

    const body = await req.json();
    const { signature_id } = body ?? {};
    if (!signature_id) {
      return new Response(JSON.stringify({ error: "signature_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sig } = await admin
      .from("contract_signatures")
      .select("id, contract_id, client_id, typed_name, ip_address, signed_at, signed_by_user_id")
      .eq("id", signature_id)
      .maybeSingle();
    if (!sig) {
      return new Response(JSON.stringify({ error: "signature not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: the signer themselves OR a studio user can trigger this.
    const { data: callerProfile } = await admin
      .from("profiles").select("role").eq("id", callerId).maybeSingle();
    const isStudio = callerProfile && ["owner","studio_manager","associate_photographer"].includes(callerProfile.role);
    if (!isStudio && sig.signed_by_user_id !== callerId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: contract }, { data: client }] = await Promise.all([
      admin.from("contracts").select("id, title, content").eq("id", sig.contract_id).maybeSingle(),
      admin.from("clients").select("couple_name_1, couple_name_2, primary_email, secondary_email").eq("id", sig.client_id).maybeSingle(),
    ]);

    const recipients = [client?.primary_email, client?.secondary_email].filter(Boolean) as string[];
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, emailed: false, warn: "no_recipients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const coupleNames = `${client?.couple_name_1 ?? ""}${client?.couple_name_2 ? ` & ${client.couple_name_2}` : ""}`;
    const signedAtFmt = new Date(sig.signed_at).toLocaleString("en-US", {
      dateStyle: "long", timeStyle: "short", timeZone: "UTC",
    }) + " UTC";
    const subject = "Your signed contract — Stories by Victoria";

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
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:400;color:#6B1F2A;font-size:28px;line-height:1.3;margin:16px 0 8px;">Your contract is signed.</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 16px;">
          <p style="font-family:'Inter',Arial,sans-serif;color:#2A1A1F;font-size:15px;line-height:1.6;margin:0;">
            Thank you, ${coupleNames}. We've recorded your signature for <em>${contract?.title ?? "your contract"}</em>.
          </p>
        </td></tr>
        <tr><td style="padding:0 40px 24px;">
          <table width="100%" style="border-top:1px solid #E8DAD9;border-bottom:1px solid #E8DAD9;padding:16px 0;">
            <tr><td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#7A6A6E;padding:6px 0;">Signed by</td>
                <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#2A1A1F;padding:6px 0;text-align:right;">${sig.typed_name}</td></tr>
            <tr><td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#7A6A6E;padding:6px 0;">Signed at</td>
                <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#2A1A1F;padding:6px 0;text-align:right;">${signedAtFmt}</td></tr>
            <tr><td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#7A6A6E;padding:6px 0;">IP recorded</td>
                <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#2A1A1F;padding:6px 0;text-align:right;">${sig.ip_address ?? "—"}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 40px 24px;">
          <p style="font-family:'Inter',Arial,sans-serif;color:#2A1A1F;font-size:14px;line-height:1.6;margin:0;">
            Your signed copy is always available in your portal under Documents.
          </p>
        </td></tr>
        <tr><td style="border-top:1px solid #E8DAD9;padding:24px 40px;">
          <p style="font-family:'Playfair Display',Georgia,serif;font-style:italic;color:#6B1F2A;font-size:14px;margin:0;">with care,<br/>Stories by Victoria</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY missing; skipping email send");
      return new Response(JSON.stringify({ ok: true, emailed: false, warn: "no_resend_key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Stories by Victoria <hello@mail.victoriaboustani.com>",
        to: recipients,
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("resend send failed", r.status, errText);
      return new Response(JSON.stringify({ ok: true, emailed: false, warn: "email_failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log to activity feed
    await admin.from("activity_log").insert({
      user_id: sig.signed_by_user_id,
      action_type: "contract.signed",
      target_type: "contract",
      target_id: sig.contract_id,
      description: `Contract signed by ${sig.typed_name}`,
      metadata: { signature_id: sig.id, client_id: sig.client_id },
    });

    return new Response(JSON.stringify({ ok: true, emailed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-contract-receipt error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
