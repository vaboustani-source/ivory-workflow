// Supabase Edge Function: send-message-notification
// Sends transactional emails to conversation participants when a new message is posted.
// Falls back gracefully if RESEND_API_KEY is not set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    // Support both direct invocation ({message_id}) and Supabase DB webhook ({type, record})
    const message_id =
      payload?.message_id ??
      payload?.record?.id ??
      payload?.new?.id ??
      null;
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, is_internal_note, created_at, sender:profiles!messages_sender_id_fkey(full_name, email), conversation:conversations(client_id, client:clients(couple_name_1, couple_name_2))")
      .eq("id", message_id)
      .maybeSingle();

    if (msgErr || !msg) {
      console.warn("message not found", msgErr);
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participants } = await supabase
      .from("conversation_participants")
      .select("user_id, last_read_at, email_notifications_enabled, role_in_conversation, user:profiles!conversation_participants_user_id_fkey(email, full_name, role)")
      .eq("conversation_id", msg.conversation_id);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.log("RESEND_API_KEY not set — skipping email notifications, message persisted normally.");
      return new Response(JSON.stringify({ status: "skipped", reason: "no_resend_key" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const senderName = (msg as any).sender?.full_name ?? "Stories by Victoria";
    const couple = (msg as any).conversation?.client;
    const coupleNames = couple
      ? `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`
      : "your client";
    const preview = (msg.content ?? "").substring(0, 120);
    const portalUrl = "https://storiesbyvictoria.lovable.app/studio/messages";

    const sent: string[] = [];
    const skipped: string[] = [];

    for (const p of (participants ?? []) as any[]) {
      if (p.user_id === msg.sender_id) { skipped.push(p.user_id + ":self"); continue; }
      if (!p.email_notifications_enabled) { skipped.push(p.user_id + ":disabled"); continue; }
      if (p.user?.role === "client" && msg.is_internal_note) { skipped.push(p.user_id + ":internal_to_client"); continue; }
      if (p.last_read_at && new Date(p.last_read_at).getTime() > tenMinAgo) { skipped.push(p.user_id + ":recently_read"); continue; }
      if (!p.user?.email) { skipped.push(p.user_id + ":no_email"); continue; }

      const subject = `New message from ${senderName} — Stories by Victoria`;
      const html = `<!doctype html><html><body style="font-family: Georgia, serif; background:#F5EDE6; padding:32px; color:#2A1A1F;">
  <div style="max-width:560px; margin:0 auto; background:#fff; padding:32px; border-top:3px solid #B8924A;">
    <p style="font-style: italic; font-size:20px; color:#6B1F2A; margin:0 0 16px;">A new message from ${senderName}</p>
    <p style="margin:0 0 8px; font-size:13px; color:#7A6A6E; text-transform: uppercase; letter-spacing:0.1em;">Re: ${coupleNames}</p>
    <blockquote style="border-left:2px solid #B8924A; margin:16px 0; padding:8px 16px; color:#2A1A1F; font-size:15px; line-height:1.6;">
      ${preview.replace(/</g, "&lt;").replace(/\n/g, "<br>")}${(msg.content ?? "").length > 120 ? "…" : ""}
    </blockquote>
    <p style="margin:24px 0;">
      <a href="${portalUrl}" style="background:#6B1F2A; color:#F5EDE6; padding:10px 20px; text-decoration:none; border-radius:4px; font-size:14px;">Open in Studio</a>
    </p>
    <p style="font-size:11px; color:#7A6A6E; margin-top:32px;">with care, Stories by Victoria</p>
  </div>
</body></html>`;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "Stories by Victoria <hello@mail.storiesbyvictoria.com>",
            to: [p.user.email],
            subject,
            html,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          console.warn(`Resend error for ${p.user.email}: ${res.status} ${errText}`);
          skipped.push(p.user_id + ":resend_error");
        } else {
          sent.push(p.user.email);
        }
      } catch (err) {
        console.warn(`Resend exception for ${p.user.email}`, err);
        skipped.push(p.user_id + ":exception");
      }
    }

    // Best-effort activity log
    await supabase.from("activity_log").insert({
      action_type: "message_notifications_sent",
      target_type: "message",
      target_id: message_id,
      description: `Notifications sent: ${sent.length}, skipped: ${skipped.length}`,
      metadata: { sent, skipped },
    });

    return new Response(JSON.stringify({ status: "ok", sent: sent.length, skipped: skipped.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-message-notification error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
