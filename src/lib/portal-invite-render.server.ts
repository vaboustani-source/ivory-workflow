// Server-only renderer for the portal invitation email.
// Mirrors supabase/functions/_emails (brand + template + buildPortalInvite)
// so the Postmark TanStack send path produces the same branded HTML.

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

function resolveCopy(schemaKey: string, fieldKey: string, overrides: Record<string, string>): string {
  if (overrides[fieldKey] != null && overrides[fieldKey] !== "") return overrides[fieldKey];
  const schema = EMAIL_COPY_SCHEMAS[schemaKey];
  const def = schema?.fields.find((f) => f.key === fieldKey);
  return def?.defaultValue ?? "";
}

function renderPlaceholders(s: string, ctx: Record<string, string | undefined | null>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : `{${k}}`));
}

export type PortalInviteVariant = "initial" | "resend" | "partner";

export interface BuildPortalInviteArgs {
  overrides: Record<string, string>;
  link: string;
  coupleFirstNames: string;
  coupleFullNames: string;
  variant: PortalInviteVariant;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  textBody: string;
}

export function buildPortalInviteEmail(args: BuildPortalInviteArgs): BuiltEmail {
  const { overrides, link, coupleFirstNames, coupleFullNames, variant } = args;
  const ctx = {
    couple_first_names: coupleFirstNames,
    couple_full_names: coupleFullNames,
    studio_name: BRAND.studioName,
  };
  const r = (key: string) => renderPlaceholders(resolveCopy("portal_invite", key, overrides), ctx);

  let subject: string;
  let headingText: string;
  let bodyText: string;
  if (variant === "partner") {
    subject = `Your partner invited you to your wedding portal — ${BRAND.studioName}`;
    headingText = "Join your partner on this journey.";
    bodyText = `You've been invited to join the wedding portal for ${coupleFullNames}. We've prepared a quiet, beautiful space to walk through every step of your photography journey together.`;
  } else if (variant === "resend") {
    subject = r("subject_resend");
    headingText = r("heading_resend");
    bodyText = r("body_resend");
  } else {
    subject = r("subject");
    headingText = r("heading");
    bodyText = r("body");
  }
  const buttonLabel = r("button_label");
  const expiryNote = r("expiry_note");

  const preheader =
    variant === "partner"
      ? `You've been invited to ${coupleFullNames}'s wedding portal.`
      : variant === "resend"
        ? "A reminder of your private planning portal."
        : "Your private wedding planning portal awaits.";

  const headingBlock = `<h1 style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.burgundy};font-size:28px;line-height:1.3;margin:0 0 16px;text-align:center;">${escapeHtml(headingText)}</h1>`;
  const bodyBlock = `<p style="font-family:${BRAND.fontBody};color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">${escapeHtml(bodyText)}</p>`;
  const buttonBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 16px;"><tr><td style="background:${BRAND.burgundy};border-radius:4px;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-family:${BRAND.fontBody};color:${BRAND.cream};font-size:14px;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;">${escapeHtml(buttonLabel)}</a></td></tr></table>`;
  const expiryBlock = `<p style="font-family:${BRAND.fontBody};color:${BRAND.textSecondary};font-size:12px;line-height:1.5;margin:8px 0 0;text-align:center;">${escapeHtml(expiryNote)}</p>`;

  const contentHtml = `${headingBlock}${bodyBlock}${buttonBlock}${expiryBlock}`;
  const websiteLabel = BRAND.studioWebsite.replace(/^https?:\/\//, "");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="light only" /><title>${BRAND.studioName}</title>
<link href="${BRAND.fontHeadingsUrl}" rel="stylesheet" /><link href="${BRAND.fontBodyUrl}" rel="stylesheet" />
<style>@media only screen and (max-width: 620px){.sbv-card{width:100%!important;border-radius:0!important;}.sbv-pad{padding-left:24px!important;padding-right:24px!important;}}</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.plum};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.plum};padding:48px 16px;"><tr><td align="center">
<table role="presentation" class="sbv-card" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.18);max-width:${BRAND.emailMaxWidth}px;">
<tr><td align="center" style="padding:36px 40px 8px;"><div style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.gold};font-size:34px;letter-spacing:3px;">${BRAND.studioMonogram}</div></td></tr>
<tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 8px;">${contentHtml}</td></tr>
<tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 32px;"><p style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.burgundy};font-size:15px;margin:0;">with care,<br/>${BRAND.studioName}</p></td></tr>
</table>
<table role="presentation" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="max-width:${BRAND.emailMaxWidth}px;"><tr><td align="center" style="padding:20px 24px 0;"><a href="${BRAND.studioWebsite}" style="font-family:${BRAND.fontBody};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${BRAND.cream};opacity:0.7;text-decoration:none;">${websiteLabel}</a></td></tr></table>
</td></tr></table></body></html>`;

  const textBody = `${headingText}\n\n${bodyText}\n\n${buttonLabel}: ${link}\n\n${expiryNote}\n\nwith care,\n${BRAND.studioName}`;

  return { subject, html, textBody };
}
