// Server-only renderer for the "new message" notification email.
// Mirrors supabase/functions/_emails (brand + buildMessageNotification) so
// the Postmark TanStack send path produces the same SBV-branded HTML.

import { EMAIL_COPY_SCHEMAS } from "@/lib/email-copy-schemas";

const BRAND = {
  cream: "#F5EDE6",
  burgundy: "#6B1F2A",
  plum: "#4A1F3D",
  gold: "#B8924A",
  textPrimary: "#2A1820",
  textSecondary: "#7A6B70",
  emailMaxWidth: 600,
  contentPadding: 40,
  studioName: "Stories by Victoria",
  studioMonogram: "SBV",
  studioWebsite: "https://victoriaboustani.com",
  fontHeadingsUrl:
    "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&display=swap",
  fontBodyUrl:
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap",
  fontHeadings: "'Playfair Display', Georgia, serif",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function resolveCopy(field: string, overrides: Record<string, string>): string {
  if (overrides[field] != null && overrides[field] !== "") return overrides[field];
  const schema = EMAIL_COPY_SCHEMAS.message_notification;
  return schema?.fields.find((f) => f.key === field)?.defaultValue ?? "";
}

function renderPlaceholders(s: string, ctx: Record<string, string | undefined | null>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : `{${k}}`));
}

export interface BuildMessageNotificationArgs {
  overrides: Record<string, string>;
  coupleFirstNames: string;
  coupleFullNames: string;
  senderName: string;
  messagePreview: string;
  link: string;
  isMentioned: boolean;
  /** Overrides the subject line entirely so all messages in one conversation share a thread. */
  forcedSubject?: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  textBody: string;
}

export function buildMessageNotificationEmail(args: BuildMessageNotificationArgs): BuiltEmail {
  const { overrides, coupleFirstNames, coupleFullNames, senderName, messagePreview, link, isMentioned, forcedSubject } = args;
  const ctx = {
    couple_first_names: coupleFirstNames,
    couple_full_names: coupleFullNames,
    sender_name: senderName,
    studio_name: BRAND.studioName,
  };
  const r = (key: string) => renderPlaceholders(resolveCopy(key, overrides), ctx);

  const subject = forcedSubject ?? r(isMentioned ? "subject_mentioned" : "subject");
  const headingText = r(isMentioned ? "heading_mentioned" : "heading");
  const buttonLabel = r("button_label");
  const reLabel = `Re: ${coupleFullNames}`;

  const trimmed = messagePreview.slice(0, 240);
  const previewSafe = escapeHtml(trimmed).replace(/\n/g, "<br/>") + (messagePreview.length > 240 ? "…" : "");
  const preheaderText = `${senderName}: ${trimmed.slice(0, 80)}${messagePreview.length > 80 ? "…" : ""}`;

  const headingBlock = `<h1 style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.burgundy};font-size:26px;line-height:1.3;margin:0 0 16px;">${escapeHtml(headingText)}</h1>`;
  const reBlock = `<p style="font-family:${BRAND.fontBody};color:${BRAND.textSecondary};font-size:11px;text-transform:uppercase;letter-spacing:0.18em;margin:0 0 10px;">${escapeHtml(reLabel)}</p>`;
  const noteBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;"><tr><td style="border-left:2px solid ${BRAND.gold};padding:10px 18px;background:${BRAND.cream};"><p style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.textPrimary};font-size:14px;line-height:1.65;margin:0;white-space:pre-wrap;">${previewSafe}</p></td></tr></table>`;
  const buttonBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;"><tr><td align="center" bgcolor="${BRAND.burgundy}" style="border-radius:4px;"><a href="${link}" style="display:inline-block;background:${BRAND.burgundy};color:${BRAND.cream};text-decoration:none;font-family:${BRAND.fontBody};font-size:14px;font-weight:500;letter-spacing:0.5px;padding:14px 32px;border-radius:4px;">${escapeHtml(buttonLabel)}</a></td></tr></table>`;

  const contentHtml = `${headingBlock}${reBlock}${noteBlock}${buttonBlock}`;
  const websiteLabel = BRAND.studioWebsite.replace(/^https?:\/\//, "");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="light only" /><title>${BRAND.studioName}</title>
<link href="${BRAND.fontHeadingsUrl}" rel="stylesheet" /><link href="${BRAND.fontBodyUrl}" rel="stylesheet" />
<style>@media only screen and (max-width: 620px){.sbv-card{width:100%!important;border-radius:0!important;}.sbv-pad{padding-left:24px!important;padding-right:24px!important;}}</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.plum};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheaderText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.plum};padding:48px 16px;"><tr><td align="center">
<table role="presentation" class="sbv-card" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.18);max-width:${BRAND.emailMaxWidth}px;">
<tr><td align="center" style="padding:36px 40px 8px;"><div style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.gold};font-size:34px;letter-spacing:3px;">${BRAND.studioMonogram}</div></td></tr>
<tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 8px;">${contentHtml}</td></tr>
<tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 32px;"><p style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.burgundy};font-size:15px;margin:0;">with care,<br/>${BRAND.studioName}</p></td></tr>
</table>
<table role="presentation" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="max-width:${BRAND.emailMaxWidth}px;"><tr><td align="center" style="padding:20px 24px 0;"><a href="${BRAND.studioWebsite}" style="font-family:${BRAND.fontBody};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${BRAND.cream};opacity:0.7;text-decoration:none;">${websiteLabel}</a></td></tr></table>
</td></tr></table></body></html>`;

  const textBody = `${headingText}\n${reLabel}\n\n${messagePreview}\n\n${buttonLabel}: ${link}\n\nwith care,\n${BRAND.studioName}`;

  return { subject, html, textBody };
}
