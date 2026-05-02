// Supabase Edge Function: preview-emails
// Owner-only QA tool. Sends sample versions of each transactional email to a
// recipient so we can review the rendered output across clients.
//
// Invoke from browser console (after logging in as owner):
//   fetch("/functions/v1/preview-emails", { method: "POST",
//     headers: { Authorization: `Bearer ${session.access_token}`,
//                "Content-Type": "application/json" },
//     body: JSON.stringify({ recipient: "you@example.com",
//                            types: ["portal_invite","message_notification",
//                                    "contract_sent","form_sent","contract_receipt"] }) })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { renderEmailTemplate } from "../_emails/template.ts";
import {
  heading, paragraph, paragraphRich, button, noteBlock,
  smallLabel, divider, detailRow, escapeHtml,
} from "../_emails/components.ts";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PreviewType =
  | "portal_invite"
  | "message_notification"
  | "contract_sent"
  | "form_sent"
  | "contract_receipt";

const SAMPLE = {
  coupleName1: "Sarah",
  coupleNames: "Sarah & James",
  senderName: "Victoria",
  message:
    "Just wanted to share a few quick thoughts after our call today — I loved hearing about the chapel ceremony and the family dinner. I'll start sketching out the timeline tomorrow.",
  personalNote:
    "We had such a beautiful conversation today — can't wait to capture your day.",
  contractTitle: "Wedding Photography Agreement",
  signerName: "Sarah Mitchell",
  ip: "203.0.113.42",
  link: "https://example.com/portal/welcome?token=preview",
  portalUrl: "https://example.com/portal",
};

function buildEmail(type: PreviewType): { subject: string; html: string } {
  switch (type) {
    case "portal_invite": {
      const subject = `[PREVIEW] Welcome to your wedding portal — ${BRAND.studioName}`;
      const contentHtml = `
        ${heading(`Welcome to your story.`)}
        ${paragraphRich(`We're so glad you're here. We've prepared a quiet, beautiful space for you to walk through your wedding photography journey with us — every milestone, every detail, every memory.`)}
        ${button("Open your portal", SAMPLE.link)}
        <p style="font-family:${BRAND.fontBody};color:${BRAND.textSecondary};font-size:12px;line-height:1.5;margin:8px 0 0;text-align:center;">This link expires in 7 days.</p>
      `;
      return { subject, html: renderEmailTemplate({ preheader: "Your private wedding planning portal awaits.", contentHtml }) };
    }
    case "message_notification": {
      const subject = `[PREVIEW] New message from ${SAMPLE.senderName} — ${BRAND.studioName}`;
      const previewSafe = escapeHtml(SAMPLE.message.slice(0, 200)).replace(/\n/g, "<br/>");
      const contentHtml = `
        ${heading(`A new message from ${SAMPLE.senderName}.`)}
        ${smallLabel(`Re: ${SAMPLE.coupleNames}`)}
        ${noteBlock(previewSafe)}
        ${button("Open in Studio", SAMPLE.portalUrl)}
      `;
      return { subject, html: renderEmailTemplate({ preheader: `${SAMPLE.senderName}: ${SAMPLE.message.slice(0, 80)}…`, contentHtml }) };
    }
    case "contract_sent": {
      const subject = `[PREVIEW] Your contract is ready — ${BRAND.studioName}`;
      const intro = `Your wedding photography contract is ready to review and sign. Take your time — we're here whenever you have questions.`;
      const contentHtml = `
        ${heading(`Hi ${SAMPLE.coupleName1},`)}
        ${paragraph(intro)}
        ${noteBlock(escapeHtml(SAMPLE.personalNote))}
        ${button("Review & sign", SAMPLE.portalUrl)}
      `;
      return { subject, html: renderEmailTemplate({ preheader: intro.slice(0, 100), contentHtml }) };
    }
    case "form_sent": {
      const subject = `[PREVIEW] We have a few questions for you — ${BRAND.studioName}`;
      const intro = `When you have a moment, would you mind answering a few questions? It helps us prepare for your day.`;
      const contentHtml = `
        ${heading(`Hi ${SAMPLE.coupleName1},`)}
        ${paragraph(intro)}
        ${button("Open form", SAMPLE.portalUrl)}
      `;
      return { subject, html: renderEmailTemplate({ preheader: intro.slice(0, 100), contentHtml }) };
    }
    case "contract_receipt": {
      const subject = `[PREVIEW] Your signed contract — ${BRAND.studioName}`;
      const contentHtml = `
        ${heading(`Hi ${SAMPLE.coupleNames},`)}
        ${paragraph(`Thank you. Your contract has been signed and recorded.`)}
        ${paragraph(`We've kept a copy in your portal — you can view it anytime under Documents.`)}
        ${divider()}
        ${smallLabel("Signature details")}
        ${detailRow("Signed by", SAMPLE.signerName)}
        ${detailRow("Date", new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }))}
        ${detailRow("Contract", SAMPLE.contractTitle)}
        ${detailRow("IP recorded", SAMPLE.ip)}
      `;
      return { subject, html: renderEmailTemplate({ preheader: "Your contract has been signed and recorded.", contentHtml }) };
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id ?? null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", callerId).maybeSingle();
    if (!profile || profile.role !== "owner") {
      return new Response(JSON.stringify({ error: "forbidden — owner only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { recipient, types } = body as { recipient?: string; types?: PreviewType[] };
    if (!recipient || !Array.isArray(types) || types.length === 0) {
      return new Response(JSON.stringify({ error: "recipient and types[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ type: string; emailed: boolean; warn?: string }> = [];
    for (const t of types) {
      try {
        const { subject, html } = buildEmail(t);
        const r = await sendEmail({ to: recipient, subject, html });
        results.push({ type: t, emailed: r.emailed, warn: r.warn });
      } catch (e) {
        console.error("preview build/send failed", t, e);
        results.push({ type: t, emailed: false, warn: String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, recipient, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("preview-emails error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
