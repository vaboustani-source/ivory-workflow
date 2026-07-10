// Sends a couple a link to complete a specific questionnaire, via Postmark.
// Uses the portal (login-required) link — no tokened public link exists for
// questionnaires today.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

const inputSchema = z.object({
  questionnaire_id: z.string().uuid(),
  to: z.string().email().optional(),
});

function getPortalBaseUrl(): string {
  const envBase = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  return "https://ivory-workflow.lovable.app";
}

export const sendFormLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || !["owner", "studio_manager"].includes(profile.role)) {
      return { ok: false, error: "Not authorized." } as const;
    }

    const { data: q, error: qErr } = await supabase
      .from("questionnaires")
      .select("id, client_id, template:questionnaire_templates(name)")
      .eq("id", data.questionnaire_id)
      .maybeSingle();
    if (qErr || !q) return { ok: false, error: "Form not found." } as const;

    const { data: client } = await supabase
      .from("clients")
      .select("primary_email, couple_name_1, couple_name_2")
      .eq("id", q.client_id)
      .maybeSingle();
    if (!client) return { ok: false, error: "Client not found." } as const;

    const recipient = (data.to ?? client.primary_email ?? "").trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return { ok: false, error: "No valid recipient email on file." } as const;
    }

    const link = `${getPortalBaseUrl()}/portal/questionnaires?questionnaire_id=${q.id}`;
    const formName = (q as any).template?.name ?? "your form";
    const firstName = client.couple_name_1?.split(" ")[0] ?? "there";

    const subject = `A quick form for you: ${formName}`;
    const textBody =
      `Hi ${firstName},\n\n` +
      `When you have a few minutes, I'd love for you to fill out ${formName}. ` +
      `It helps me plan every detail of your day.\n\n` +
      `Open it here: ${link}\n\n` +
      `You can save as you go and come back anytime. Let me know if anything feels unclear.\n\n` +
      `With love,\nVictoria`;
    const htmlBody =
      `<div style="font-family: Georgia, serif; color:#2b2b2b; font-size:15px; line-height:1.7;">` +
      `<p>Hi ${firstName},</p>` +
      `<p>When you have a few minutes, I'd love for you to fill out <strong>${formName}</strong>. ` +
      `It helps me plan every detail of your day.</p>` +
      `<p><a href="${link}" style="background:#7a5a3a;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;">Open ${formName}</a></p>` +
      `<p style="font-size:13px;color:#666;">Or paste this link into your browser:<br/>${link}</p>` +
      `<p>You can save as you go and come back anytime. Let me know if anything feels unclear.</p>` +
      `<p>With love,<br/>Victoria</p>` +
      `</div>`;

    const { sendEmail, POSTMARK_DEFAULTS } = await import("@/integrations/postmark/client.server");
    const sendResult = await sendEmail({
      to: recipient,
      subject,
      htmlBody,
      textBody,
      tag: "form_link",
      metadata: { client_id: q.client_id, questionnaire_id: q.id },
    });

    const status = sendResult.success
      ? "sent"
      : sendResult.errorCode === "405" || /test mode|approved sender/i.test(sendResult.error ?? "")
        ? "test_mode_blocked"
        : "failed";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const logPayload: TablesInsert<"email_sends"> = {
      to_address: recipient,
      from_address: POSTMARK_DEFAULTS.from,
      reply_to: POSTMARK_DEFAULTS.replyTo,
      subject,
      template_key: "form_link",
      client_id: q.client_id,
      postmark_message_id: sendResult.messageId ?? null,
      status,
      error_message: sendResult.error ?? null,
      error_code: sendResult.errorCode ?? null,
      tag: "form_link",
      metadata: { questionnaire_id: q.id, sent_by: userId } as Json,
      raw_response: (sendResult.rawResponse ?? null) as Json | null,
    };
    await supabaseAdmin.from("email_sends").insert(logPayload);

    if (status === "failed") {
      return { ok: false, status, error: sendResult.error ?? "Send failed" } as const;
    }
    return { ok: true, status, link, emailed: status === "sent" } as const;
  });
