// Supabase Edge Function: draft-reply-with-claude
// Generates a short, neutral-voice draft reply for a queue item using Anthropic Claude.
// Falls back to a plain template if ANTHROPIC_API_KEY is missing or the API call fails.
//
// Request body:
// {
//   item_type: "message_reply" | "contract_followup" | "questionnaire_followup" | "mention_reply",
//   context: {
//     couple_names?: string,
//     last_message?: string,         // for message_reply / mention_reply
//     mention_excerpt?: string,      // for mention_reply
//     contract_title?: string,       // for contract_followup
//     days_outstanding?: number,     // contract_followup / questionnaire_followup
//     questionnaire_name?: string,   // for questionnaire_followup
//     wedding_date?: string | null,
//   }
// }
//
// Response: { draft: string, source: "claude" | "fallback", error?: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ItemType = "message_reply" | "contract_followup" | "questionnaire_followup" | "mention_reply";

interface DraftContext {
  couple_names?: string;
  last_message?: string;
  mention_excerpt?: string;
  contract_title?: string;
  days_outstanding?: number;
  questionnaire_name?: string;
  wedding_date?: string | null;
}

const SYSTEM_PROMPT = `You are an assistant drafting brief, warm, professional replies on behalf of a wedding photography studio called Stories by Victoria. Keep replies to 2-4 short sentences. Tone: calm, gracious, neutral — never gushing, never clinical. Do not invent specific facts (dates, prices, names) that are not in the context. Do not sign off with a name — the sender will add their own signature. Plain text only, no markdown.`;

function buildPrompt(itemType: ItemType, ctx: DraftContext): string {
  const couple = ctx.couple_names || "the couple";
  switch (itemType) {
    case "message_reply":
      return `Draft a brief reply to this message from ${couple}:\n\n"${(ctx.last_message ?? "").slice(0, 800)}"\n\nWrite only the reply text.`;
    case "mention_reply":
      return `You were mentioned in a message thread with ${couple}. The mention context:\n\n"${(ctx.mention_excerpt ?? ctx.last_message ?? "").slice(0, 800)}"\n\nDraft a brief reply addressing what was raised. Write only the reply text.`;
    case "contract_followup":
      return `${couple} received a contract titled "${ctx.contract_title ?? "their contract"}" ${ctx.days_outstanding ?? "a few"} days ago and have not signed yet. Draft a gentle, non-pushy follow-up nudging them to review and sign when they have a moment. Offer to answer questions. Write only the message text.`;
    case "questionnaire_followup":
      return `${couple} were sent a questionnaire ("${ctx.questionnaire_name ?? "questionnaire"}") ${ctx.days_outstanding ?? "several"} days ago and haven't started it. Draft a warm, brief nudge encouraging them to fill it in when they get a chance. Mention that their answers help us prepare. Write only the message text.`;
  }
}

function fallbackDraft(itemType: ItemType, ctx: DraftContext): string {
  const couple = ctx.couple_names || "you";
  switch (itemType) {
    case "message_reply":
      return `Hi ${couple} — thank you for the note. I'll take a look and circle back with you shortly.`;
    case "mention_reply":
      return `Thanks for the mention — looking at this now and will follow up shortly.`;
    case "contract_followup":
      return `Hi ${couple} — just a gentle nudge that the ${ctx.contract_title ?? "contract"} is ready for your review whenever you have a moment. Let me know if any questions come up while you're reading.`;
    case "questionnaire_followup":
      return `Hi ${couple} — whenever you have a quiet moment, would you mind filling in the ${ctx.questionnaire_name ?? "questionnaire"} we sent over? Your answers help us prepare. No rush, just wanted to put it back on your radar.`;
  }
}

async function callClaude(itemType: ItemType, ctx: DraftContext, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(itemType, ctx) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Claude API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Claude returned empty response");
    }
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const itemType = body?.item_type as ItemType | undefined;
    const ctx: DraftContext = body?.context ?? {};

    if (!itemType || !["message_reply", "contract_followup", "questionnaire_followup", "mention_reply"].includes(itemType)) {
      return new Response(JSON.stringify({ error: "invalid item_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({
        draft: fallbackDraft(itemType, ctx),
        source: "fallback",
        error: "ANTHROPIC_API_KEY not configured",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const draft = await callClaude(itemType, ctx, apiKey);
      return new Response(JSON.stringify({ draft, source: "claude" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.warn("Claude draft failed, using fallback:", err);
      return new Response(JSON.stringify({
        draft: fallbackDraft(itemType, ctx),
        source: "fallback",
        error: String(err).slice(0, 300),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (err) {
    console.error("draft-reply-with-claude error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
