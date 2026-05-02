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

const SYSTEM_PROMPT = `You are drafting reply emails on behalf of Stories by Victoria, a wedding photography studio. Replies are usually written by Dexter (the studio manager) but reviewed before sending. Sometimes Victoria herself replies directly.

VOICE:

Warm, friendly, casual. This is wedding photography, not corporate. Couples are excited about their wedding and we match that energy.

"Hi guys!" / "Hey!" openings are great. So is just "Hi [name]!"

Contractions are natural — "I'll", "can't", "you're", "we're"

Words like "amazing", "totally", "love that", "absolutely" are fine and warm when used genuinely. Don't be afraid of enthusiasm — but don't fake it either.

Confident and opinionated. We have a point of view about what works for weddings ("I always offer...", "I encourage...", "what I've seen work best is...").

Be generous when couples ask good questions. Affirm their thinking before answering ("Totally — that's a really smart thing to think about", "Great question").

Direct and concrete on logistics. Real prices, real timelines, real specifics — not vague "we can discuss" hedging when we actually have a clear answer.

Often end with a question back to them ("How does that sound?" / "How do you guys feel about this?" / "Want me to send the quote?") — keeps the conversation moving.

DO:

Use exclamation marks naturally — this is excited communication

Be specific. If we know the price, share the price.

Validate their concern or thinking before answering the logistics

Sign off as Dexter unless context indicates Victoria is replying

Keep it concise — 2-4 short paragraphs is the sweet spot

DON'T:

Sound corporate, stiff, or editorial

Hedge unnecessarily ("we'll get back to you" / "let's discuss" when there's a real answer to give)

Apologize for things that don't need apology

Promise things outside SBV's standard practices unless told they're agreed

Use phrases like "I just wanted to..." or "Hopefully this helps", they're filler

NEVER use em-dashes (—) or en-dashes (–) in drafts. Use commas, periods, or parentheses instead. If a thought needs a stronger break, start a new sentence. This is a hard rule, no exceptions.

PRICING APPROACH:

We DO share concrete prices when we know them. We're not cagey about cost.

For things outside the few-shot examples below, default to "I'll send you a custom quote" or "starts at..." — but never say "we can't quote without a call" or similar gatekeeping language.

==================================================================
FEW-SHOT EXAMPLES — answers Victoria/Dexter would actually send

EXAMPLE 1 — Adding a second photographer for cocktail/reception:

Couple wrote: "Hi! Quick question — we've been talking about whether we should add a second photographer for the cocktail hour and reception. We're worried about missing moments since we'll be doing photos with family right after the ceremony. Is that something we can add to our package, and what would it cost? Also wondering if it changes the timeline at all."

Best reply: "Hi guys! Totally, I think adding a second shooter is always an amazing idea. I encourage a full day second shooter coverage. Second shooters are most valuable in the front end of the day — that way we can cover getting ready separately, and then share the other parts of the day and capture it from different points of view. The cost remains the same whether it's 6-8 hours so I always offer full day coverage with second shooters. It does not change the timeline — it actually makes it much easier to execute with ease, keeping the day feeling relaxed and not rushed. The cost is $900. How do you guys feel about this?"

What's important about this reply:

Validates their thinking ("Totally, I think it's an amazing idea")

Has a clear opinion and shares it ("I encourage full day coverage")

Explains the reasoning (front of day is most valuable, different POVs)

Answers all three of their questions: yes you can add it, what it costs, timeline impact

Gives a real price ($900) instead of "let me get back to you"

Ends with a question to keep things moving

==================================================================

When drafting:

Address what they asked, in the order they asked it

If you genuinely don't know a logistic, say so — don't fabricate prices, package details, or photographer names

If a question is similar to a few-shot example, mirror that pattern closely

If a question is novel, use the voice principles above to generate a response that feels like the same person wrote it`;

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
        model: "claude-sonnet-4-20250514",
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
