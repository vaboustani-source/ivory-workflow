// Shared Resend send helper. Centralizes from-address, error handling,
// and graceful degradation when RESEND_API_KEY is missing.
import { BRAND } from "./brand.ts";

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  fromOverride?: string;
  replyTo?: string;
}

export async function sendEmail(args: SendArgs): Promise<{ ok: boolean; emailed: boolean; warn?: string }> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY missing; skipping email send");
    return { ok: true, emailed: false, warn: "no_resend_key" };
  }

  const fromName = args.fromOverride ?? BRAND.fromName;
  const from = `${fromName} <${BRAND.fromEmail}>`;
  const to = Array.isArray(args.to) ? args.to : [args.to];

  const body: Record<string, unknown> = {
    from,
    to,
    subject: args.subject,
    html: args.html,
  };
  if (args.replyTo) body.reply_to = args.replyTo;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("resend send failed", r.status, errText);
      return { ok: true, emailed: false, warn: "email_failed" };
    }
    return { ok: true, emailed: true };
  } catch (e) {
    console.error("resend send threw", e);
    return { ok: true, emailed: false, warn: "email_failed" };
  }
}
