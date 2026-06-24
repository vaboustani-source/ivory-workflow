// TanStack server function that sends message notifications via Postmark.
// Replaces the legacy `send-message-notification` Resend edge function for all
// in-app callers. The edge function remains in place but unused (deprecated).
//
// Mirrors the edge function's recipient + suppression rules exactly:
//  - Skip the sender
//  - Skip participants whose email_notifications_enabled is false
//  - Skip participants whose last_read_at is within the last ~10 minutes
//  - Internal notes: only notify @mentioned studio users (never clients)
//  - When the studio sends a non-internal message, also email the couple's
//    primary_email + secondary_email as a safety net
//  - Consistent per-conversation subject: "Stories by Victoria — {couple first names}"
//
// Threading: persists Postmark's MessageID to messages.email_message_id and
// sends RFC-5322 Message-ID / In-Reply-To / References built from prior
// email_message_id values in the same conversation. Reply-To stays as the
// studio inbox for now — Slice 2 introduces the tokened parse address.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

const inputSchema = z.object({
  message_id: z.string().uuid(),
});

const STUDIO_MESSAGES_URL = "https://studio.victoriaboustani.com/studio/messages";
const PORTAL_MESSAGES_URL = "https://studio.victoriaboustani.com/portal/messages";
const MESSAGE_ID_DOMAIN = "victoriaboustani.com";

function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").split(" ")[0] ?? "";
}

function buildMessageId(messageRowId: string): string {
  return `<msg-${messageRowId}@${MESSAGE_ID_DOMAIN}>`;
}

export const sendMessageNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    return runMessageNotification(data.message_id, context.userId);
  });

/**
 * Pure async implementation — exported so verification scripts can drive it
 * without an HTTP request / auth-middleware. Production callers must go
 * through `sendMessageNotification` so RLS-on-caller is gated.
 */
export async function runMessageNotification(message_id: string, userId: string) {
  const data = { message_id };
  {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load the message + sender + conversation + couple.
    const { data: msg, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select(
        "id, conversation_id, sender_id, content, is_internal_note, created_at, email_message_id, sender:profiles!messages_sender_id_fkey(full_name, email, role), conversation:conversations(client_id, client:clients(couple_name_1, couple_name_2, primary_email, secondary_email))",
      )
      .eq("id", data.message_id)
      .maybeSingle();
    if (msgErr || !msg) {
      return { ok: false, error: "Message not found" } as const;
    }

    // Defensive: only the sender (or an owner/manager) may trigger sends for
    // this message. RLS would have already gated the insert; this guards the
    // server function itself from being called for arbitrary message ids.
    if (msg.sender_id && msg.sender_id !== userId) {
      const { data: callerRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["owner", "studio_manager"])
        .maybeSingle();
      if (!callerRole) {
        return { ok: false, error: "Not authorized for this message" } as const;
      }
    }

    const [{ data: participants }, { data: mentions }] = await Promise.all([
      supabaseAdmin
        .from("conversation_participants")
        .select(
          "user_id, last_read_at, email_notifications_enabled, role_in_conversation, user:profiles!conversation_participants_user_id_fkey(email, full_name, role)",
        )
        .eq("conversation_id", msg.conversation_id),
      supabaseAdmin
        .from("message_mentions")
        .select("mentioned_user_id")
        .eq("message_id", data.message_id),
    ]);

    const mentionedIds = new Set((mentions ?? []).map((m) => m.mentioned_user_id));
    const hasMentions = mentionedIds.size > 0;

    if (msg.is_internal_note && !hasMentions) {
      return { ok: true, status: "skipped", reason: "internal_no_mentions", sent: 0 } as const;
    }

    const sender = (msg as { sender?: { full_name: string | null; email: string | null; role: string | null } | null }).sender;
    const senderName = sender?.full_name ?? "Stories by Victoria";
    const senderRole = sender?.role ?? null;
    const senderIsStudio = senderRole != null && senderRole !== "client";
    const couple = (msg as { conversation?: { client_id: string; client: { couple_name_1: string | null; couple_name_2: string | null; primary_email: string | null; secondary_email: string | null } | null } | null }).conversation?.client ?? null;
    const clientId = (msg as { conversation?: { client_id: string } | null }).conversation?.client_id ?? null;

    const coupleFirstNames = couple
      ? `${firstNameOf(couple.couple_name_1)}${couple.couple_name_2 ? " & " + firstNameOf(couple.couple_name_2) : ""}`
      : "your client";
    const coupleFullNames = couple
      ? `${couple.couple_name_1 ?? ""}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`
      : "your client";
    const consistentSubject = `Stories by Victoria — ${coupleFirstNames}`;

    // ─── Recipients ──────────────────────────────────────────────────────────
    type Recipient = { email: string; isMentioned: boolean; kind: "participant" | "couple"; userId?: string };
    const recipients: Recipient[] = [];
    const seenEmails = new Set<string>();
    const tenMinAgo = Date.now() - 10 * 60 * 1000;

    for (const p of (participants ?? []) as Array<{
      user_id: string;
      last_read_at: string | null;
      email_notifications_enabled: boolean | null;
      user: { email: string | null; full_name: string | null; role: string | null } | null;
    }>) {
      if (p.user_id === msg.sender_id) continue;
      if (p.email_notifications_enabled === false) continue;
      if (!p.user?.email) continue;
      if (p.user?.role !== "client" && msg.is_internal_note && !mentionedIds.has(p.user_id)) continue;
      if (p.user?.role === "client" && msg.is_internal_note) continue;
      if (p.last_read_at && new Date(p.last_read_at).getTime() > tenMinAgo) continue;

      const lower = p.user.email.toLowerCase();
      if (seenEmails.has(lower)) continue;
      seenEmails.add(lower);
      recipients.push({
        email: p.user.email,
        isMentioned: mentionedIds.has(p.user_id),
        kind: "participant",
        userId: p.user_id,
      });
    }

    // Couple safety net (studio sender, non-internal note only).
    if (senderIsStudio && !msg.is_internal_note && couple) {
      const coupleEmails = [couple.primary_email, couple.secondary_email].filter((x): x is string => !!x);
      for (const e of coupleEmails) {
        const lower = e.toLowerCase();
        if (seenEmails.has(lower)) continue;
        seenEmails.add(lower);
        recipients.push({ email: e, isMentioned: false, kind: "couple" });
      }
    }

    if (recipients.length === 0) {
      return { ok: true, status: "skipped", reason: "no_recipients", sent: 0 } as const;
    }

    // ─── Threading: read prior email_message_id values in this conversation
    //     (oldest first) so References chains correctly.
    const { data: priorMsgs } = await supabaseAdmin
      .from("messages")
      .select("id, email_message_id, created_at")
      .eq("conversation_id", msg.conversation_id)
      .not("email_message_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(50);

    const priorMessageIds = (priorMsgs ?? [])
      .filter((m) => m.id !== msg.id && m.email_message_id)
      .map((m) => m.email_message_id as string);

    const thisMessageId = buildMessageId(msg.id);
    const inReplyTo = priorMessageIds.length > 0 ? priorMessageIds[priorMessageIds.length - 1] : null;
    const referencesHeader = priorMessageIds.length > 0 ? priorMessageIds.join(" ") : null;

    // Persist our outbound Message-ID for the first send (idempotent: only set
    // if currently null so re-invocations don't churn the header).
    if (!msg.email_message_id) {
      await supabaseAdmin
        .from("messages")
        .update({ email_message_id: thisMessageId })
        .eq("id", msg.id)
        .is("email_message_id", null);
    }

    // ─── Render + send ──────────────────────────────────────────────────────
    const { data: copyRow } = await supabaseAdmin
      .from("email_template_copy")
      .select("copy")
      .eq("email_type", "message_notification")
      .maybeSingle();
    const overrides = ((copyRow?.copy as Record<string, string> | null) ?? {});

    const { buildMessageNotificationEmail } = await import("@/lib/message-notification-render.server");
    const { sendEmail, POSTMARK_DEFAULTS } = await import("@/integrations/postmark/client.server");

    const sentMessageIds: string[] = [];
    const skipped: string[] = [];

    for (const rec of recipients) {
      const link = rec.kind === "couple" ? PORTAL_MESSAGES_URL : STUDIO_MESSAGES_URL;
      const { subject, html, textBody } = buildMessageNotificationEmail({
        overrides,
        coupleFirstNames,
        coupleFullNames,
        senderName,
        messagePreview: msg.content ?? "",
        link,
        isMentioned: rec.isMentioned,
        forcedSubject: consistentSubject,
      });

      const threadingHeaders: Array<{ Name: string; Value: string }> = [
        { Name: "Message-ID", Value: thisMessageId },
      ];
      if (inReplyTo) threadingHeaders.push({ Name: "In-Reply-To", Value: inReplyTo });
      if (referencesHeader) threadingHeaders.push({ Name: "References", Value: referencesHeader });

      const sendResult = await sendEmail({
        to: rec.email,
        subject,
        htmlBody: html,
        textBody,
        // Slice 2: switch Reply-To to reply+<conv>.<msg>.<hmac>@parse.victoriaboustani.com
        // once the Postmark inbound webhook + reply-token verification land.
        replyTo: POSTMARK_DEFAULTS.replyTo,
        tag: "message_notification",
        metadata: {
          conversation_id: msg.conversation_id,
          message_id: msg.id,
          ...(clientId ? { client_id: clientId } : {}),
          recipient_kind: rec.kind,
        },
        headers: threadingHeaders,
      });

      const status = sendResult.success
        ? "sent"
        : sendResult.errorCode === "405" || /test mode|approved sender/i.test(sendResult.error ?? "")
          ? "test_mode_blocked"
          : "failed";

      const logPayload: TablesInsert<"email_sends"> = {
        to_address: rec.email,
        from_address: POSTMARK_DEFAULTS.from,
        reply_to: POSTMARK_DEFAULTS.replyTo,
        subject,
        template_key: "message_notification",
        client_id: clientId,
        postmark_message_id: sendResult.messageId ?? null,
        status,
        error_message: sendResult.error ?? null,
        error_code: sendResult.errorCode ?? null,
        tag: "message_notification",
        metadata: {
          conversation_id: msg.conversation_id,
          message_id: msg.id,
          recipient_kind: rec.kind,
          is_mentioned: rec.isMentioned,
          sender_id: msg.sender_id,
        } as Json,
        raw_response: (sendResult.rawResponse ?? null) as Json | null,
      };
      const { data: logRow } = await supabaseAdmin
        .from("email_sends")
        .insert(logPayload)
        .select("id")
        .single();

      if (status === "failed") {
        skipped.push(`${rec.email}:${sendResult.error ?? "send_failed"}`);
        // Activity log entry for the failure (per-recipient).
        await supabaseAdmin.from("activity_log").insert({
          user_id: userId,
          action_type: "message_notification_failed",
          target_type: "message",
          target_id: msg.id,
          client_id: clientId,
          description: `Message notification email failed for ${rec.email}: ${sendResult.error ?? "unknown"}`,
          metadata: {
            recipient: rec.email,
            email_send_id: logRow?.id ?? null,
            error_code: sendResult.errorCode ?? null,
          } as Json,
        });
      } else {
        sentMessageIds.push(sendResult.messageId ?? "test_mode");
      }
    }

    // One activity_log summary entry for the message (matches the legacy edge fn behavior).
    await supabaseAdmin.from("activity_log").insert({
      user_id: userId,
      action_type: "message_notifications_sent",
      target_type: "message",
      target_id: msg.id,
      client_id: clientId,
      description: `Message notifications: ${sentMessageIds.length} sent, ${skipped.length} failed`,
      metadata: {
        sent: sentMessageIds.length,
        failed: skipped.length,
        threading_message_id: thisMessageId,
        had_in_reply_to: !!inReplyTo,
      } as Json,
    });

    return {
      ok: true,
      status: "ok",
      sent: sentMessageIds.length,
      failed: skipped.length,
      message_id_header: thisMessageId,
    } as const;
  }
}
