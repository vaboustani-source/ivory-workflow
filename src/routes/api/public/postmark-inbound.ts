// Postmark Inbound webhook for two-way messaging (Slice 2).
//
// SECURITY MODEL — checks run in this order; any failure short-circuits:
//   1. Shared secret in the URL: requires `?secret=<POSTMARK_INBOUND_SECRET>`
//      to match exactly. Mismatched/absent => 401. Postmark is configured
//      with the secret embedded in the webhook URL so this proves the call
//      came from our Postmark account.
//   2. Reply token recovered from `MailboxHash` first, then fallback to the
//      local-part of `OriginalRecipient` / `To`. Token shape is
//      `<conversation_id>.<message_id>.<hmac16>` where hmac is
//      HMAC-SHA256(POSTMARK_INBOUND_SECRET, `${conv}.${msg}`) truncated to
//      16 hex chars. timing-safe compare. Bad/missing token => 200 + log
//      (Postmark must not retry forever for a malformed address).
//   3. Auto-responder check: if `Headers` contains `Auto-Submitted` !=
//      "no" OR `X-Autoreply` is present OR Precedence is bulk/auto =>
//      200 + skip.
//   4. Sender identity: From email must belong to the conversation's client
//      — either a `client_users` row (matched via profiles.email) for that
//      client, or the client's `primary_email` / `secondary_email`. No
//      match => 200 + log activity but do NOT insert.
//   5. Insert the message: TextBody with quoted history stripped, plus the
//      inbound MessageID persisted to messages.email_message_id. Best-effort
//      attachment upload to the `message-attachments` bucket; attachment
//      failures are logged but never fail the message insert.
//
// Always returns 200 for handled-or-intentionally-skipped cases so Postmark
// does not retry indefinitely. Returns non-200 only for hard auth failures.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
// NOTE: messaging-reply-token.server.ts is imported lazily inside handlers
// because route files are part of the client module graph at module scope
// (only handler bodies are stripped) and that module pulls in node:crypto.

const AttachmentSchema = z.object({
  Name: z.string(),
  Content: z.string(), // base64
  ContentType: z.string(),
  ContentLength: z.number().optional(),
  ContentID: z.string().optional(),
});

const HeaderSchema = z.object({ Name: z.string(), Value: z.string() });

const InboundSchema = z.object({
  From: z.string().optional().default(""),
  FromFull: z.object({ Email: z.string().optional() }).optional(),
  To: z.string().optional().default(""),
  OriginalRecipient: z.string().optional().default(""),
  MailboxHash: z.string().optional().default(""),
  Subject: z.string().optional().default(""),
  MessageID: z.string().optional().default(""),
  TextBody: z.string().optional().default(""),
  HtmlBody: z.string().optional().default(""),
  StrippedTextReply: z.string().optional().default(""),
  Headers: z.array(HeaderSchema).optional().default([]),
  Attachments: z.array(AttachmentSchema).optional().default([]),
});

/**
 * Strip quoted history + signatures from a plain-text email reply.
 * Best-effort — never throws.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return "";
  // Normalize line endings
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const cutMarkers: RegExp[] = [
    /^On .+ wrote:\s*$/i,                   // "On Tue, Jun 24, 2026 at 10:00 AM, Foo wrote:"
    /^Le .+ a écrit\s*:\s*$/i,
    /^Am .+ schrieb .+:\s*$/i,
    /^El .+ escribió:\s*$/i,
    /^-----\s*Original Message\s*-----\s*$/i,
    /^_{5,}\s*$/,                           // long underscore separator (Outlook)
    /^From:\s.+/i,                          // Outlook reply header start
    /^Sent from my .+/i,
    /^Get Outlook for .+/i,
  ];

  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (cutMarkers.some((re) => re.test(line))) {
      cutAt = i;
      break;
    }
    // Run of >2 consecutive quoted lines also marks the start of the quote.
    if (line.startsWith(">")) {
      let j = i;
      while (j < lines.length && (lines[j].trim().startsWith(">") || lines[j].trim() === "")) j++;
      if (j - i >= 2) {
        cutAt = i;
        break;
      }
    }
  }

  const body = lines.slice(0, cutAt).join("\n");
  // Trim trailing signature delimiter "-- " block + trailing whitespace.
  const sigIdx = body.search(/\n--\s*\n/);
  const trimmed = sigIdx >= 0 ? body.slice(0, sigIdx) : body;
  return trimmed.replace(/\s+$/g, "").trim();
}

function headerValue(headers: Array<{ Name: string; Value: string }>, name: string): string | null {
  const h = headers.find((x) => x.Name.toLowerCase() === name.toLowerCase());
  return h ? h.Value : null;
}

function isAutoResponder(headers: Array<{ Name: string; Value: string }>): boolean {
  const autoSubmitted = headerValue(headers, "Auto-Submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  if (headerValue(headers, "X-Autoreply")) return true;
  if (headerValue(headers, "X-Autorespond")) return true;
  const precedence = (headerValue(headers, "Precedence") ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "auto_reply" || precedence === "list") return true;
  return false;
}

/**
 * Pull the reply token from a Postmark inbound payload. Prefers
 * `MailboxHash` (Postmark's parsed local-part after `+`), falls back to
 * scanning `OriginalRecipient` and `To` for a `reply+...` address.
 */
type TokenModule = typeof import("@/lib/messaging-reply-token.server");
function recoverToken(payload: z.infer<typeof InboundSchema>, tokens: TokenModule) {
  if (payload.MailboxHash) {
    const t = tokens.parseReplyToken(payload.MailboxHash);
    if (t) return t;
  }
  for (const candidate of [payload.OriginalRecipient, payload.To]) {
    if (!candidate) continue;
    // To can be "Name <addr>, Name <addr>" — scan each address
    const addrs = candidate.match(/[^\s,<>]+@[^\s,<>]+/g) ?? [];
    for (const a of addrs) {
      const t = tokens.parseReplyToken(a);
      if (t) return t;
    }
  }
  return null;
}

function extractFromEmail(payload: z.infer<typeof InboundSchema>): string {
  const fromFull = payload.FromFull?.Email;
  if (fromFull) return fromFull.toLowerCase().trim();
  const m = (payload.From ?? "").match(/[^\s<>]+@[^\s<>]+/);
  return (m?.[0] ?? "").toLowerCase().trim();
}

/**
 * Core handler — exported separately so verification can drive it without
 * an HTTP round-trip. Returns an object describing the outcome; never
 * throws for "expected" cases (bad token, stranger sender, etc.).
 */
export async function processInboundPayload(payload: z.infer<typeof InboundSchema>): Promise<{
  status: "inserted" | "skipped" | "rejected";
  reason?: string;
  message_id?: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tokens = await import("@/lib/messaging-reply-token.server");

  // 1. Auto-responder filter
  if (isAutoResponder(payload.Headers)) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_skipped",
      target_type: "conversation",
      description: "Inbound email skipped: auto-responder",
      metadata: { from: extractFromEmail(payload), subject: payload.Subject } as never,
    });
    return { status: "skipped", reason: "auto_responder" };
  }

  // 2. Token recovery + HMAC verify
  const token = recoverToken(payload, tokens);
  if (!token) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_skipped",
      target_type: "conversation",
      description: "Inbound email skipped: missing/malformed reply token",
      metadata: { from: extractFromEmail(payload), to: payload.To, mailbox_hash: payload.MailboxHash } as never,
    });
    return { status: "skipped", reason: "missing_token" };
  }
  if (!tokens.verifyReplyToken(token)) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_rejected",
      target_type: "conversation",
      target_id: token.conversationId,
      description: "Inbound email rejected: HMAC verification failed",
      metadata: { from: extractFromEmail(payload) } as never,
    });
    return { status: "rejected", reason: "bad_hmac" };
  }

  // 3. Load conversation + client + members
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("conversations")
    .select("id, client_id, client:clients(id, primary_email, secondary_email)")
    .eq("id", token.conversationId)
    .maybeSingle();
  if (convErr || !conv || !conv.client_id) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_rejected",
      target_type: "conversation",
      target_id: token.conversationId,
      description: "Inbound email rejected: conversation not found or unlinked",
      metadata: { from: extractFromEmail(payload) } as never,
    });
    return { status: "rejected", reason: "conversation_missing" };
  }
  const clientId: string = conv.client_id;

  const fromEmail = extractFromEmail(payload);
  if (!fromEmail) {
    return { status: "skipped", reason: "no_from" };
  }

  const client = (conv as { client?: { id: string; primary_email: string | null; secondary_email: string | null } | null }).client ?? null;
  const coupleEmails = [client?.primary_email, client?.secondary_email]
    .filter((x): x is string => !!x)
    .map((e) => e.toLowerCase());

  // Look up client_users for this client, then their profile emails.
  const { data: clientUsers } = await supabaseAdmin
    .from("client_users")
    .select("user_id, partner_email")
    .eq("client_id", clientId);

  const partnerEmails = (clientUsers ?? [])
    .map((c) => (c.partner_email ?? "").toLowerCase())
    .filter((e) => !!e);
  const userIds = (clientUsers ?? [])
    .map((c) => c.user_id)
    .filter((x): x is string => !!x);

  let matchedUserId: string | null = null;
  if (userIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    const hit = (profs ?? []).find((p) => (p.email ?? "").toLowerCase() === fromEmail);
    if (hit) matchedUserId = hit.id;
  }

  const isCoupleEmail = coupleEmails.includes(fromEmail) || partnerEmails.includes(fromEmail);

  if (!matchedUserId && !isCoupleEmail) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_skipped",
      target_type: "conversation",
      target_id: conv.id,
      client_id: clientId,
      description: `Inbound email skipped: sender ${fromEmail} not a member of this client`,
      metadata: { from: fromEmail } as never,
    });
    return { status: "skipped", reason: "sender_not_member" };
  }

  // 4. Build content
  const rawText = payload.StrippedTextReply && payload.StrippedTextReply.trim().length > 0
    ? payload.StrippedTextReply
    : payload.TextBody;
  const content = stripQuotedReply(rawText) || "(no content)";

  // 5. Insert message
  const insertPayload = {
    conversation_id: conv.id,
    sender_id: matchedUserId, // may be null if we matched on couple email but no client_users link
    content,
    is_internal_note: false,
    email_message_id: payload.MessageID || null,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("messages")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr || !inserted) {
    await supabaseAdmin.from("activity_log").insert({
      action_type: "inbound_email_failed",
      target_type: "conversation",
      target_id: conv.id,
      client_id: clientId,
      description: `Inbound email insert failed: ${insErr?.message ?? "unknown"}`,
      metadata: { from: fromEmail } as never,
    });
    return { status: "rejected", reason: "insert_failed" };
  }

  // 6. Bump conversation last_message_at (best-effort).
  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conv.id);

  // 7. Attachments (best-effort, never fail the message on a single bad upload).
  if (payload.Attachments && payload.Attachments.length > 0) {
    for (const att of payload.Attachments) {
      try {
        const bytes = Buffer.from(att.Content, "base64");
        const path = `${conv.id}/${inserted.id}/${att.Name}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("message-attachments")
          .upload(path, bytes, { contentType: att.ContentType, upsert: false });
        if (upErr) {
          await supabaseAdmin.from("activity_log").insert({
            action_type: "inbound_attachment_failed",
            target_type: "message",
            target_id: inserted.id,
            client_id: clientId,
            description: `Inbound attachment upload failed for ${att.Name}: ${upErr.message}`,
          });
          continue;
        }
        const { data: signed } = await supabaseAdmin.storage
          .from("message-attachments")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        await supabaseAdmin.from("message_attachments").insert({
          message_id: inserted.id,
          file_name: att.Name,
          file_url: signed?.signedUrl ?? "",
          storage_path: path,
          file_size_bytes: att.ContentLength ?? bytes.byteLength,
          mime_type: att.ContentType,
          uploaded_by: matchedUserId,
        });
      } catch (e) {
        await supabaseAdmin.from("activity_log").insert({
          action_type: "inbound_attachment_failed",
          target_type: "message",
          target_id: inserted.id,
          client_id: clientId,
          description: `Inbound attachment error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  return { status: "inserted", message_id: inserted.id };
}

export const Route = createFileRoute("/api/public/postmark-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env.POSTMARK_INBOUND_SECRET;
        if (!expectedSecret) {
          return new Response("Inbound not configured", { status: 503 });
        }

        const url = new URL(request.url);
        const providedSecret = url.searchParams.get("secret") ?? "";
        if (providedSecret !== expectedSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const parsed = InboundSchema.safeParse(raw);
        if (!parsed.success) {
          return new Response("Bad payload", { status: 400 });
        }

        try {
          const result = await processInboundPayload(parsed.data);
          return Response.json(result, { status: 200 });
        } catch (e) {
          // Swallow — log and 200 so Postmark doesn't retry forever.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("activity_log").insert({
            action_type: "inbound_email_error",
            target_type: "conversation",
            description: `Inbound email handler threw: ${e instanceof Error ? e.message : String(e)}`,
          });
          return Response.json({ status: "skipped", reason: "handler_error" }, { status: 200 });
        }
      },
    },
  },
});
