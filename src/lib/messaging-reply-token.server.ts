// Server-only helpers for the tokened Reply-To used by the Postmark inbound
// flow (Slice 2 of two-way messaging). The token is embedded into the local
// part of the Reply-To address as `reply+<conv>.<msg>.<hmac>@<domain>` and
// later verified by the inbound webhook before any DB insert.
//
// HMAC = first 16 hex chars of HMAC-SHA256(POSTMARK_INBOUND_SECRET,
//        `${conversationId}.${messageId}`)
//
// Implemented with WebCrypto (globalThis.crypto.subtle) so the module stays
// bundler-friendly in both the Worker runtime and the Node-based dev server
// without pulling node:crypto into any client chunk.

const HMAC_LEN = 16; // hex chars
export const REPLY_DOMAIN = "reply.victoriaboustani.com";

function getSecret(): string {
  const s = process.env.POSTMARK_INBOUND_SECRET;
  if (!s) throw new Error("POSTMARK_INBOUND_SECRET is not configured");
  return s;
}

const encoder = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(msg));
  return bytesToHex(sig);
}

export async function computeReplyHmac(conversationId: string, messageId: string): Promise<string> {
  const full = await hmacSha256Hex(getSecret(), `${conversationId}.${messageId}`);
  return full.slice(0, HMAC_LEN);
}

export async function buildReplyToken(conversationId: string, messageId: string): Promise<string> {
  const h = await computeReplyHmac(conversationId, messageId);
  return `${conversationId}.${messageId}.${h}`;
}

export async function buildReplyToAddress(conversationId: string, messageId: string): Promise<string> {
  return `reply+${await buildReplyToken(conversationId, messageId)}@${REPLY_DOMAIN}`;
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
  raw = raw.replace(/^<|>$/g, "");
  if (raw.includes("@")) raw = raw.split("@")[0] ?? "";
  if (raw.startsWith("reply+")) raw = raw.slice("reply+".length);

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [conversationId, messageId, hmac] = parts;
  if (!conversationId || !messageId || !hmac) return null;
  if (conversationId.length < 8 || messageId.length < 8) return null;
  if (!/^[0-9a-f]+$/i.test(hmac)) return null;
  return { conversationId, messageId, hmac };
}

/**
 * Constant-time comparison of two equal-length hex strings. Avoids
 * `crypto.timingSafeEqual` so we stay off node:crypto.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyReplyToken(token: ParsedReplyToken): Promise<boolean> {
  const expected = await computeReplyHmac(token.conversationId, token.messageId);
  return timingSafeEqualHex(expected.toLowerCase(), token.hmac.toLowerCase());
}
