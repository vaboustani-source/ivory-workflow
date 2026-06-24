// Server-only Postmark client. The .server.ts extension keeps this out of
// the client bundle (same protection as src/integrations/supabase/client.server.ts).
//
// All sends go through `sendEmail(...)`. Callers get a typed { success, ... }
// result back — failures (including Postmark "test mode" rejections during
// the account approval window) are returned, not thrown.

const DEFAULT_FROM = "Stories by Victoria <studio@victoriaboustani.com>";
const DEFAULT_REPLY_TO = "studio@victoriaboustani.com";
const POSTMARK_API = "https://api.postmarkapp.com/email";

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  from?: string;
  tag?: string;
  metadata?: Record<string, string>;
  /** Custom RFC 5322 headers, e.g. Message-ID, In-Reply-To, References. */
  headers?: Array<{ Name: string; Value: string }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  rawResponse?: unknown;
}

interface PostmarkResponse {
  To?: string;
  SubmittedAt?: string;
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    return {
      success: false,
      error: "POSTMARK_SERVER_TOKEN is not configured",
      errorCode: "missing_token",
    };
  }

  const to = Array.isArray(args.to) ? args.to.join(", ") : args.to;
  const payload: Record<string, unknown> = {
    From: args.from ?? DEFAULT_FROM,
    To: to,
    ReplyTo: args.replyTo ?? DEFAULT_REPLY_TO,
    Subject: args.subject,
    HtmlBody: args.htmlBody,
    MessageStream: "outbound",
  };
  if (args.textBody) payload.TextBody = args.textBody;
  if (args.tag) payload.Tag = args.tag;
  if (args.metadata) payload.Metadata = args.metadata;
  if (args.headers && args.headers.length > 0) payload.Headers = args.headers;

  try {
    const res = await fetch(POSTMARK_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify(payload),
    });

    const body: PostmarkResponse = await res.json().catch(() => ({}));

    if (!res.ok || (body.ErrorCode && body.ErrorCode !== 0)) {
      return {
        success: false,
        error: body.Message ?? `Postmark HTTP ${res.status}`,
        errorCode: body.ErrorCode != null ? String(body.ErrorCode) : `http_${res.status}`,
        rawResponse: body,
      };
    }

    return {
      success: true,
      messageId: body.MessageID,
      rawResponse: body,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: "fetch_failed",
    };
  }
}

export const POSTMARK_DEFAULTS = {
  from: DEFAULT_FROM,
  replyTo: DEFAULT_REPLY_TO,
} as const;
