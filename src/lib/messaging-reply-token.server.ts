// Server-only helpers for the tokened Reply-To used by the Postmark inbound
// flow (Slice 2 of two-way messaging). The token is embedded into the local
// part of the Reply-To address as `reply+<conv>.<msg>.<hmac>@<domain>` and
// later verified by the inbound webhook before any DB insert.
//
// HMAC = first 16 hex chars of HMAC-SHA256(POSTMARK_INBOUND_SECRET,
//        `${conversationId}.${messageId}`)
//
// Truncation to 16 hex chars (64 bits) is plenty for replay/forgery
// resistance combined with the per-conversation conv_id + msg_id binding,
// and keeps the local-part well under SMTP's 64-char limit.

import { createHmac, timingSafeEqual } from "crypto";

const HMAC_LEN = 16; // hex chars
export const REPLY_DOMAIN = "reply.victoriaboustani.com";

function getSecret(): string {
  const s = process.env.POSTMARK_INBOUND_SECRET;
  if (!s) throw new Error("POSTMARK_INBOUND_SECRET is not configured");
  return s;
}

export function computeReplyHmac(conversationId: string, messageId: string): string {
  return createHmac("sha256", getSecret())
    .update(`${conversationId}.${messageId}`)
    .digest("hex")
    .slice(0, HMAC_LEN);
}

export function buildReplyToken(conversationId: string, messageId: string): string {
  return `${conversationId}.${messageId}.${computeReplyHmac(conversationId, messageId)}`;
}

export function buildReplyToAddress(conversationId: string, messageId: string): string {
  return `reply+${buildReplyToken(conversationId, messageId)}@${REPLY_DOMAIN}`;
}

export interface ParsedReplyToken {
  conversationId: string;
  messageId: string;
  hmac: string;
}

/**
 * Extract a token from either:
 *  - a raw mailbox hash (`<conv>.<msg>.<hmac>`)
 *  - a full email address local-part (`reply+<conv>.<msg>.<hmac>@...`)
 *  - the address itself
 *
 * Returns null if the shape is wrong.
 */
export function parseReplyToken(input: string | null | undefined): ParsedReplyToken | null {
  if (!input) return null;
  let raw = input.trim();
  // strip angle brackets
  raw = raw.replace(/^<|>$/g, "");
  // pull local part if an @ is present
  if (raw.includes("@")) raw = raw.split("@")[0] ?? "";
  // strip reply+ prefix
  if (raw.startsWith("reply+")) raw = raw.slice("reply+".length);

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [conversationId, messageId, hmac] = parts;
  if (!conversationId || !messageId || !hmac) return null;
  // basic shape checks (UUIDs are 36 chars w/ dashes; messageId may be uuid)
  if (conversationId.length < 8 || messageId.length < 8) return null;
  if (!/^[0-9a-f]+$/i.test(hmac)) return null;
  return { conversationId, messageId, hmac };
}

export function verifyReplyToken(token: ParsedReplyToken): boolean {
  const expected = computeReplyHmac(token.conversationId, token.messageId);
  if (expected.length !== token.hmac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token.hmac, "hex"));
  } catch {
    return false;
  }
}
