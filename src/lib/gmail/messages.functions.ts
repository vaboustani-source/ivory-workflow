// Per-user Gmail read/send. All functions scoped to the signed-in user's
// own gmail_accounts row via getGmailClientForUser(context.userId).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------- Types ----------------

export type ThreadSummary = {
  threadId: string;
  snippet: string;
  from: string;
  fromName: string;
  subject: string;
  internalDate: string; // ms-since-epoch as string
  unread: boolean;
};

export type ThreadListResult = {
  threads: ThreadSummary[];
  nextPageToken: string | null;
};

export type GmailAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type ParsedMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  internalDate: string;
  text: string;
  html: string;
  attachments: GmailAttachment[];
  rfc822MessageId: string | null;
  references: string | null;
  unread: boolean;
};

export type ThreadDetail = {
  threadId: string;
  messages: ParsedMessage[];
};

// ---------------- MIME helpers ----------------

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}
function b64urlDecodeStr(s: string): string {
  return Buffer.from(b64urlDecode(s)).toString("utf8");
}
function b64urlEncode(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

type GHeader = { name: string; value: string };
type GPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GPart[];
};
type GMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GPart;
};

function header(headers: GHeader[] | undefined, name: string): string {
  const h = (headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseAddrs(v: string): string[] {
  if (!v) return [];
  // Naive split — preserves quoted-comma edge cases poorly; OK for display.
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseFromName(v: string): string {
  if (!v) return "";
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<.+>\s*$/);
  return (m?.[1] ?? v).trim();
}

function walk(payload: GPart | undefined, out: { text: string; html: string; atts: GmailAttachment[] }) {
  if (!payload) return;
  const mt = (payload.mimeType ?? "").toLowerCase();
  const isAttachment = !!payload.filename && payload.filename.length > 0;
  if (isAttachment && payload.body?.attachmentId) {
    out.atts.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename!,
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: payload.body.size ?? 0,
    });
    return;
  }
  if (mt === "text/plain" && payload.body?.data) {
    out.text += b64urlDecodeStr(payload.body.data);
  } else if (mt === "text/html" && payload.body?.data) {
    out.html += b64urlDecodeStr(payload.body.data);
  }
  for (const child of payload.parts ?? []) walk(child, out);
}

function parseMessage(m: GMessage): ParsedMessage {
  const h = m.payload?.headers;
  const acc = { text: "", html: "", atts: [] as GmailAttachment[] };
  walk(m.payload, acc);
  const labels = m.labelIds ?? [];
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(h, "From"),
    to: parseAddrs(header(h, "To")),
    cc: parseAddrs(header(h, "Cc")),
    subject: header(h, "Subject"),
    date: header(h, "Date"),
    internalDate: m.internalDate ?? "0",
    text: acc.text,
    html: acc.html,
    attachments: acc.atts,
    rfc822MessageId: header(h, "Message-ID") || null,
    references: header(h, "References") || null,
    unread: labels.includes("UNREAD"),
  };
}

// ---------------- Server functions ----------------

const listSchema = z.object({
  pageToken: z.string().optional(),
  q: z.string().max(500).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

export const listGmailThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pageToken?: string; q?: string; maxResults?: number }) =>
    listSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<ThreadListResult> => {
    const { getGmailClientForUser } = await import("./client.server");
    const client = await getGmailClientForUser(context.userId);

    const params = new URLSearchParams();
    params.set("maxResults", String(data.maxResults ?? 25));
    params.set("labelIds", "INBOX");
    if (data.pageToken) params.set("pageToken", data.pageToken);
    if (data.q) params.set("q", data.q);

    const listRes = await client.fetch(`/gmail/v1/users/me/threads?${params.toString()}`);
    if (!listRes.ok) {
      const text = await listRes.text();
      throw new Error(`gmail_list_failed:${listRes.status}:${text.slice(0, 200)}`);
    }
    const listJson = (await listRes.json()) as {
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
    };
    const ids = (listJson.threads ?? []).map((t) => t.id);

    // Hydrate each thread's most recent message in parallel (metadata only).
    const summaries = await Promise.all(
      ids.map(async (id): Promise<ThreadSummary | null> => {
        const res = await client.fetch(
          `/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        );
        if (!res.ok) return null;
        const t = (await res.json()) as {
          id: string;
          messages?: GMessage[];
        };
        const msgs = t.messages ?? [];
        if (msgs.length === 0) return null;
        const last = msgs[msgs.length - 1];
        const from = header(last.payload?.headers, "From");
        const subject = header(last.payload?.headers, "Subject");
        const unread = msgs.some((m) => (m.labelIds ?? []).includes("UNREAD"));
        return {
          threadId: t.id,
          snippet: last.snippet ?? "",
          from,
          fromName: parseFromName(from),
          subject,
          internalDate: last.internalDate ?? "0",
          unread,
        };
      }),
    );

    return {
      threads: summaries.filter((s): s is ThreadSummary => s !== null),
      nextPageToken: listJson.nextPageToken ?? null,
    };
  });

const getSchema = z.object({
  threadId: z.string().min(1).max(200),
});

export const getGmailThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { threadId: string }) => getSchema.parse(input))
  .handler(async ({ data, context }): Promise<ThreadDetail> => {
    const { getGmailClientForUser } = await import("./client.server");
    const client = await getGmailClientForUser(context.userId);

    const res = await client.fetch(
      `/gmail/v1/users/me/threads/${encodeURIComponent(data.threadId)}?format=full`,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`gmail_get_failed:${res.status}:${text.slice(0, 200)}`);
    }
    const t = (await res.json()) as { id: string; messages?: GMessage[] };
    const messages = (t.messages ?? []).map(parseMessage);

    // Best-effort: mark UNREAD messages as READ.
    const unreadIds = messages.filter((m) => m.unread).map((m) => m.id);
    if (unreadIds.length > 0) {
      await Promise.all(
        unreadIds.map((id) =>
          client.fetch(`/gmail/v1/users/me/messages/${id}/modify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
          }).catch(() => undefined),
        ),
      );
    }

    return { threadId: t.id, messages };
  });

const sendSchema = z.object({
  threadId: z.string().optional(),
  to: z.array(z.string().email()).min(1).max(50),
  cc: z.array(z.string().email()).max(50).optional(),
  subject: z.string().max(998),
  html: z.string().max(500_000).optional(),
  text: z.string().max(500_000).optional(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
});

type SendInput = z.infer<typeof sendSchema>;

function buildRfc822(args: {
  fromEmail: string;
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyToMessageId?: string;
  references?: string;
}): string {
  const boundary = "sbv_" + Math.random().toString(36).slice(2);
  const lines: string[] = [];
  lines.push(`From: ${args.fromEmail}`);
  lines.push(`To: ${args.to.join(", ")}`);
  if (args.cc && args.cc.length > 0) lines.push(`Cc: ${args.cc.join(", ")}`);
  lines.push(`Subject: ${args.subject}`);
  lines.push("MIME-Version: 1.0");
  if (args.inReplyToMessageId) lines.push(`In-Reply-To: ${args.inReplyToMessageId}`);
  if (args.references) lines.push(`References: ${args.references}`);

  const hasHtml = !!(args.html && args.html.length > 0);
  const hasText = !!(args.text && args.text.length > 0);
  const textBody = args.text ?? (args.html ? args.html.replace(/<[^>]+>/g, "") : "");

  if (hasHtml && hasText) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(textBody);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(args.html!);
    lines.push("");
    lines.push(`--${boundary}--`);
  } else if (hasHtml) {
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(args.html!);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(textBody);
  }
  return lines.join("\r\n");
}

export const sendGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SendInput) => sendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getGmailClientForUser } = await import("./client.server");
    const client = await getGmailClientForUser(context.userId);

    const rfc822 = buildRfc822({
      fromEmail: client.email ?? "me",
      to: data.to,
      cc: data.cc,
      subject: data.subject,
      html: data.html,
      text: data.text,
      inReplyToMessageId: data.inReplyToMessageId,
      references: data.references,
    });

    const payload: { raw: string; threadId?: string } = {
      raw: b64urlEncode(rfc822),
    };
    if (data.threadId) payload.threadId = data.threadId;

    const res = await client.fetch(`/gmail/v1/users/me/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`gmail_send_failed:${res.status}:${text.slice(0, 200)}`);
    }
    const sent = (await res.json()) as { id: string; threadId: string };
    return { ok: true, messageId: sent.id, threadId: sent.threadId };
  });
