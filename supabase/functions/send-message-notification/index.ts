// DEPRECATED (kept for reference / DB-webhook fallback only).
// Active path: src/lib/message-notification.functions.ts (Postmark via TanStack).
// This Resend-based edge function is no longer invoked from the app and will
// be removed once any database webhook still pointing at it is unwired.
// Supabase Edge Function: send-message-notification
// Sends transactional emails to conversation participants (studio + couple) when a new
// message is posted, with RFC 5322 threading headers (Message-ID/In-Reply-To/References)
// and a consistent per-conversation subject so replies thread in the recipient's inbox.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";
import { buildMessageNotification } from "../_emails/renderers.ts";
import { loadCopyOverrides } from "../_emails/load_overrides.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").split(" ")[0] ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json().catch(() => ({}));
    const message_id =
      payload?.message_id ?? payload?.record?.id ?? payload?.new?.id ?? null;
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
      .select("id, conversation_id, sender_id, content, is_internal_note, created_at, email_message_id, sender:profiles!messages_sender_id_fkey(full_name, email, role), conversation:conversations(client_id, client:clients(couple_name_1, couple_name_2, primary_email, secondary_email))")
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

    const { data: mentions } = await supabase
      .from("message_mentions")
      .select("mentioned_user_id")
      .eq("message_id", message_id);
    const mentionedIds = new Set((mentions ?? []).map((m: any) => m.mentioned_user_id));
    const hasMentions = mentionedIds.size > 0;

    // Skip internal notes that don't @mention anyone
    if (msg.is_internal_note && !hasMentions) {
      return new Response(JSON.stringify({ status: "skipped", reason: "internal_no_mentions" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ status: "skipped", reason: "no_resend_key" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderName = (msg as any).sender?.full_name ?? "Stories by Victoria";
    const senderRole = (msg as any).sender?.role ?? null;
    const senderIsStudio = senderRole && senderRole !== "client";
    const couple = (msg as any).conversation?.client;
    const coupleFirstNames = couple
      ? `${firstNameOf(couple.couple_name_1)}${couple.couple_name_2 ? " & " + firstNameOf(couple.couple_name_2) : ""}`
      : "your client";
    const coupleFullNames = couple
      ? `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`
      : "your client";

    // Consistent subject for the whole conversation
    const consistentSubject = `${BRAND.studioName} — ${coupleFirstNames}`;

    // ─── Email threading ───────────────────────────────────────────────────────
    // NOTE: Resend sends through Amazon SES, which silently overrides any custom
    // Message-ID header with its own (e.g. <...@email.amazonses.com>). That made
    // our In-Reply-To / References point at IDs that never appeared on the wire,
    // so Gmail couldn't thread. Resend's GET /emails/{id} also doesn't expose
    // the real SES Message-ID — only their internal UUID. The only way to
    // capture it is via webhooks, which we're intentionally avoiding here.
    //
    // Fallback strategy: rely on a consistent per-conversation subject line
    // (Gmail groups by normalized subject) plus an X-Entity-Ref-ID hint that
    // is stable per conversation. This is less precise than RFC threading but
    // works without webhook plumbing.

    const overrides = await loadCopyOverrides(supabase, "message_notification");

    // ─── Determine recipients ─────────────────────────────────────────────────
    type Recipient = { email: string; isMentioned: boolean; kind: "participant" | "couple"; userId?: string };
    const recipients: Recipient[] = [];
    const seenEmails = new Set<string>();

    const tenMinAgo = Date.now() - 10 * 60 * 1000;

    for (const p of (participants ?? []) as any[]) {
      if (p.user_id === msg.sender_id) continue;
      if (!p.email_notifications_enabled) continue;
      if (!p.user?.email) continue;
      if (p.user?.role !== "client" && msg.is_internal_note && !mentionedIds.has(p.user_id)) {
        // Internal note: only @mentioned studio users get notified
        continue;
      }
      if (p.user?.role === "client" && msg.is_internal_note) continue;
      if (p.last_read_at && new Date(p.last_read_at).getTime() > tenMinAgo) continue;

      const email = p.user.email.toLowerCase();
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      recipients.push({
        email: p.user.email,
        isMentioned: mentionedIds.has(p.user_id),
        kind: "participant",
        userId: p.user_id,
      });
    }

    // Also email the couple's primary/secondary email when studio sends a non-internal message
    // This is a safety net in case the couple isn't in conversation_participants.
    if (senderIsStudio && !msg.is_internal_note && couple) {
      const coupleEmails = [couple.primary_email, couple.secondary_email].filter(Boolean) as string[];
      for (const e of coupleEmails) {
        const lower = e.toLowerCase();
        if (seenEmails.has(lower)) continue;
        seenEmails.add(lower);
        recipients.push({ email: e, isMentioned: false, kind: "couple" });
      }
    }

    const portalUrlStudio = "https://studio.victoriaboustani.com/studio/messages";
    const portalUrlCouple = "https://studio.victoriaboustani.com/portal/messages";


    const sent: string[] = [];
    const skipped: string[] = [];

    for (const rec of recipients) {
      const ctx: Record<string, string> = {
        couple_first_names: coupleFirstNames,
        sender_name: senderName,
        studio_name: BRAND.studioName,
      };

      const built = buildMessageNotification(overrides, ctx, {
        link: rec.kind === "couple" ? portalUrlCouple : portalUrlStudio,
        isMentioned: rec.isMentioned,
        reLabel: `Re: ${coupleFullNames}`,
        messagePreview: msg.content ?? "",
      });

      // Force the consistent per-conversation subject (overrides per-email subject from copy)
      const subject = consistentSubject;

      const r = await sendEmail({
        to: rec.email,
        subject,
        html: built.html,
      });
      if (r.emailed) sent.push(rec.email);
      else skipped.push(rec.email + ":" + (r.warn ?? "send_failed"));
    }

    await supabase.from("activity_log").insert({
      action_type: "message_notifications_sent",
      target_type: "message",
      target_id: message_id,
      description: `Notifications sent: ${sent.length}, skipped: ${skipped.length}`,
      metadata: { sent, skipped, threading_strategy: "consistent_subject" },
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
