// AI categorization + draft for Gmail INBOX threads. Per-user, idempotent.
// Reuses ANTHROPIC_API_KEY and the SBV voice system prompt (mirrored from
// supabase/functions/draft-reply-with-claude). All access scoped to caller
// via requireSupabaseAuth.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ActionItemStatus =
  | "needs_review"
  | "drafted"
  | "edited"
  | "sent"
  | "dismissed"
  | "snoozed";

export const CATEGORIES = [
  "new_inquiry",
  "active_client",
  "vendor",
  "booking_scheduling",
  "admin_logistics",
  "personal",
  "promo_newsletter",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ActionItem = {
  id: string;
  thread_id: string;
  category: Category | string;
  ai_draft: string;
  ai_summary: string | null;
  status: ActionItemStatus;
  last_message_at: string | null;
  snoozed_until: string | null;
  generated_at: string;
  model: string | null;
  // Thread metadata for UI display (hydrated by listActionQueue).
  from?: string | null;
  fromName?: string | null;
  subject?: string | null;
  snippet?: string | null;
};

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are an assistant for Stories by Victoria, a wedding photography studio. You CATEGORIZE incoming emails and DRAFT short, on-brand replies.

VOICE (for drafts):
Warm, friendly, casual, confident. Contractions are natural. "Hi guys!" / "Hi [name]!" openings. End with a question to keep things moving. 2-4 short paragraphs.
NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or new sentences.
Sign off as Dexter (the studio manager) unless context clearly indicates Victoria is replying.

CATEGORIES (pick exactly one):
- new_inquiry: prospective couple reaching out for the first time
- active_client: a booked couple about their wedding
- vendor: planners, venues, florists, other wedding pros
- booking_scheduling: meeting requests, calendar coordination, reschedules
- admin_logistics: invoices, contracts, tax, payments, business operations
- personal: friends/family/personal correspondence
- promo_newsletter: marketing, newsletters, automated promotions, no reply needed
- other: anything that doesn't fit cleanly

DRAFTING RULES:
- Address only what the sender actually asked. Don't fabricate prices, dates, or details we don't know.
- If the email is promo_newsletter or personal, return an empty draft ("").
- If you genuinely cannot draft something useful, return an empty draft.

OUTPUT FORMAT — return ONLY a single JSON object, no prose, no code fences:
{"category":"<one of the categories>","summary":"<one sentence what they want>","draft":"<the reply text, or empty string>"}`;

type ClaudeResult = { category: Category; summary: string; draft: string };

function safeParse(raw: string): ClaudeResult | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(stripped);
    if (!obj || typeof obj !== "object") return null;
    const category = String(obj.category ?? "other") as Category;
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    const draft = typeof obj.draft === "string" ? obj.draft : "";
    const cat = (CATEGORIES as readonly string[]).includes(category) ? category : ("other" as Category);
    // Strip em/en-dashes as a final guard.
    const cleanDraft = draft.replace(/[—–]/g, ", ");
    return { category: cat, summary, draft: cleanDraft };
  } catch {
    return null;
  }
}

async function callClaude(input: {
  subject: string;
  fromName: string;
  messages: Array<{ from: string; date: string; text: string }>;
}): Promise<{ result: ClaudeResult; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const recent = input.messages.slice(-4);
  const transcript = recent
    .map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.text.slice(0, 2000)}`)
    .join("\n\n---\n\n");
  const userPrompt = `Subject: ${input.subject || "(no subject)"}\nSender: ${input.fromName}\n\nThread (oldest to newest, last few messages):\n\n${transcript}\n\nReturn the JSON object now.`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`claude_${res.status}:${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = data?.content?.[0]?.text ?? "";
    const parsed = safeParse(text);
    if (!parsed) throw new Error("claude_unparseable");
    return { result: parsed, model: CLAUDE_MODEL };
  } finally {
    clearTimeout(t);
  }
}

function parseFromName(v: string): string {
  if (!v) return "";
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<.+>\s*$/);
  return (m?.[1] ?? v).trim();
}

async function processThread(args: {
  userId: string;
  gmailAccountId: string;
  threadId: string;
}): Promise<ActionItem | null> {
  const { getGmailClientForUser } = await import("./client.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const client = await getGmailClientForUser(args.userId);
  const res = await client.fetch(
    `/gmail/v1/users/me/threads/${encodeURIComponent(args.threadId)}?format=full`,
  );
  if (!res.ok) throw new Error(`gmail_get_failed:${res.status}`);
  type GHeader = { name: string; value: string };
  type GPart = {
    mimeType?: string;
    filename?: string;
    headers?: GHeader[];
    body?: { data?: string };
    parts?: GPart[];
  };
  type GMessage = {
    id: string;
    threadId: string;
    labelIds?: string[];
    internalDate?: string;
    payload?: GPart;
  };
  const t = (await res.json()) as { id: string; messages?: GMessage[] };
  const msgs = t.messages ?? [];
  if (msgs.length === 0) return null;

  function header(headers: GHeader[] | undefined, name: string): string {
    const h = (headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h?.value ?? "";
  }
  function b64urlDecodeStr(s: string): string {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return Buffer.from((s + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  }
  function walkText(payload: GPart | undefined, out: { text: string; html: string }) {
    if (!payload) return;
    const mt = (payload.mimeType ?? "").toLowerCase();
    const isAttachment = !!payload.filename;
    if (isAttachment) return;
    if (mt === "text/plain" && payload.body?.data) out.text += b64urlDecodeStr(payload.body.data);
    else if (mt === "text/html" && payload.body?.data) out.html += b64urlDecodeStr(payload.body.data);
    for (const c of payload.parts ?? []) walkText(c, out);
  }

  const parsed = msgs.map((m) => {
    const acc = { text: "", html: "" };
    walkText(m.payload, acc);
    const text = (acc.text || acc.html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return {
      from: header(m.payload?.headers, "From"),
      subject: header(m.payload?.headers, "Subject"),
      date: header(m.payload?.headers, "Date"),
      internalDate: m.internalDate ?? "0",
      text,
    };
  });
  const subject = parsed[0]?.subject ?? "";
  const lastMsg = parsed[parsed.length - 1];
  const fromName = parseFromName(lastMsg.from);
  const lastMs = Number(lastMsg.internalDate) || Date.now();

  let category = "other";
  let summary: string | null = null;
  let draft = "";
  let model: string | null = null;
  try {
    const out = await callClaude({
      subject,
      fromName,
      messages: parsed.map((p) => ({ from: p.from, date: p.date, text: p.text })),
    });
    category = out.result.category;
    summary = out.result.summary;
    draft = out.result.draft;
    model = out.model;
  } catch (e) {
    // Fail-soft: persist a minimal row so the UI still shows the thread
    // and the user can manually edit / dismiss.
    category = "other";
    summary = `AI generation failed: ${(e as Error).message.slice(0, 120)}`;
    draft = "";
  }

  const status: ActionItemStatus = draft ? "drafted" : "needs_review";

  const { data: upserted, error } = await supabaseAdmin
    .from("gmail_action_items")
    .upsert(
      {
        user_id: args.userId,
        gmail_account_id: args.gmailAccountId,
        thread_id: args.threadId,
        category,
        ai_draft: draft,
        ai_summary: summary,
        status,
        last_message_at: new Date(lastMs).toISOString(),
        generated_at: new Date().toISOString(),
        model,
      },
      { onConflict: "user_id,thread_id" },
    )
    .select("id, thread_id, category, ai_draft, ai_summary, status, last_message_at, snoozed_until, generated_at, model")
    .single();
  if (error) throw error;

  return {
    ...(upserted as ActionItem),
    from: lastMsg.from,
    fromName,
    subject,
    snippet: parsed[parsed.length - 1]?.text.slice(0, 160) ?? "",
  };
}

// ---------------- Server functions ----------------

export const generateActionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { threadId: string }) =>
    z.object({ threadId: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acct } = await supabaseAdmin
      .from("gmail_accounts")
      .select("id")
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!acct) throw new Error("gmail_not_connected");
    const item = await processThread({
      userId: context.userId,
      gmailAccountId: acct.id,
      threadId: data.threadId,
    });
    return { ok: true, item };
  });

export const refreshActionQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) =>
    z.object({ limit: z.number().int().min(1).max(25).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 10;
    const { getGmailClientForUser } = await import("./client.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: acct } = await supabaseAdmin
      .from("gmail_accounts")
      .select("id")
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!acct) throw new Error("gmail_not_connected");

    const client = await getGmailClientForUser(context.userId);
    const params = new URLSearchParams({
      maxResults: String(limit),
      labelIds: "INBOX",
    });
    const listRes = await client.fetch(`/gmail/v1/users/me/threads?${params.toString()}`);
    if (!listRes.ok) throw new Error(`gmail_list_failed:${listRes.status}`);
    const listJson = (await listRes.json()) as { threads?: Array<{ id: string }> };
    const threadIds = (listJson.threads ?? []).map((x) => x.id);

    // Skip threads whose existing action item is already up-to-date AND has
    // a terminal status (sent/dismissed). For other rows, only regen when
    // last_message_at differs from existing — we approximate by re-fetching
    // the thread's latest internalDate via metadata.
    const { data: existingRows } = await supabaseAdmin
      .from("gmail_action_items")
      .select("thread_id, last_message_at, status")
      .eq("user_id", context.userId)
      .in("thread_id", threadIds);
    const existing = new Map(
      (existingRows ?? []).map((r) => [r.thread_id, r as { thread_id: string; last_message_at: string | null; status: string }]),
    );

    const results: Array<{ threadId: string; ok: boolean; error?: string }> = [];
    let generated = 0;
    for (const threadId of threadIds) {
      try {
        const ex = existing.get(threadId);
        if (ex && (ex.status === "sent" || ex.status === "dismissed")) {
          // Skip: user already acted.
          results.push({ threadId, ok: true });
          continue;
        }
        // Cheap metadata fetch to learn the latest message time.
        const metaRes = await client.fetch(
          `/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Date`,
        );
        if (metaRes.ok) {
          const meta = (await metaRes.json()) as { messages?: Array<{ internalDate?: string }> };
          const lastInternal = meta.messages?.[meta.messages.length - 1]?.internalDate;
          if (ex && lastInternal && ex.last_message_at) {
            const exMs = new Date(ex.last_message_at).getTime();
            if (Number(lastInternal) <= exMs) {
              results.push({ threadId, ok: true });
              continue;
            }
          }
        }
        await processThread({
          userId: context.userId,
          gmailAccountId: acct.id,
          threadId,
        });
        generated += 1;
        results.push({ threadId, ok: true });
      } catch (e) {
        results.push({ threadId, ok: false, error: (e as Error).message.slice(0, 200) });
      }
    }
    return { ok: true, scanned: threadIds.length, generated, results };
  });

export const listActionQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: ActionItemStatus | "open" }) =>
    z
      .object({
        status: z
          .enum(["needs_review", "drafted", "edited", "sent", "dismissed", "snoozed", "open"])
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("gmail_action_items")
      .select("id, thread_id, category, ai_draft, ai_summary, status, last_message_at, snoozed_until, generated_at, model")
      .eq("user_id", context.userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (data.status && data.status !== "open") {
      q = q.eq("status", data.status);
    } else {
      // Default = "open" = anything not sent/dismissed
      q = q.in("status", ["needs_review", "drafted", "edited", "snoozed"]);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) return { items: [] as ActionItem[] };

    // Hydrate metadata for display.
    const { getGmailClientForUser } = await import("./client.server");
    const client = await getGmailClientForUser(context.userId);
    const items = await Promise.all(
      rows.map(async (r): Promise<ActionItem> => {
        const base = r as Omit<ActionItem, "from" | "fromName" | "subject" | "snippet">;
        try {
          const res = await client.fetch(
            `/gmail/v1/users/me/threads/${r.thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          );
          if (!res.ok) return base as ActionItem;
          const meta = (await res.json()) as {
            messages?: Array<{ snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } }>;
          };
          const last = meta.messages?.[meta.messages.length - 1];
          const hdrs = last?.payload?.headers ?? [];
          const from = hdrs.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
          const subject = hdrs.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
          return {
            ...base,
            from,
            fromName: parseFromName(from),
            subject,
            snippet: last?.snippet ?? "",
          };
        } catch {
          return base as ActionItem;
        }
      }),
    );
    return { items };
  });

export const updateActionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string;
    ai_draft?: string;
    status?: ActionItemStatus;
    snoozed_until?: string | null;
  }) =>
    z
      .object({
        id: z.string().uuid(),
        ai_draft: z.string().max(50_000).optional(),
        status: z.enum(["needs_review", "drafted", "edited", "sent", "dismissed", "snoozed"]).optional(),
        snoozed_until: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      ai_draft?: string;
      status?: ActionItemStatus;
      snoozed_until?: string | null;
    } = {};
    if (data.ai_draft !== undefined) {
      patch.ai_draft = data.ai_draft;
      if (!data.status) patch.status = "edited";
    }
    if (data.status !== undefined) patch.status = data.status;
    if (data.snoozed_until !== undefined) patch.snoozed_until = data.snoozed_until;
    const { error } = await supabaseAdmin
      .from("gmail_action_items")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
