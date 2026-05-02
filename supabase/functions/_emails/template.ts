// Master email envelope. Plum background, cream content card,
// gold monogram, italic signoff, footer with website.
import { BRAND } from "./brand.ts";

interface EmailTemplateOptions {
  preheader?: string;
  contentHtml: string;
  hideSignoff?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderEmailTemplate(opts: EmailTemplateOptions): string {
  const websiteLabel = BRAND.studioWebsite.replace(/^https?:\/\//, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${BRAND.studioName}</title>
  <link href="${BRAND.fontHeadingsUrl}" rel="stylesheet" />
  <link href="${BRAND.fontBodyUrl}" rel="stylesheet" />
  <style>
    @media only screen and (max-width: 620px) {
      .sbv-card { width: 100% !important; border-radius: 0 !important; }
      .sbv-pad { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.plum};">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(opts.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.plum};padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" class="sbv-card" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.18);max-width:${BRAND.emailMaxWidth}px;">
        <tr><td align="center" style="padding:36px 40px 8px;">
          <div style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.gold};font-size:34px;letter-spacing:3px;">${BRAND.studioMonogram}</div>
        </td></tr>
        <tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 8px;">
          ${opts.contentHtml}
        </td></tr>
        ${opts.hideSignoff ? "" : `
        <tr><td class="sbv-pad" style="padding:16px ${BRAND.contentPadding}px 32px;">
          <p style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.burgundy};font-size:15px;margin:0;">with care,<br/>${BRAND.studioName}</p>
        </td></tr>
        `}
      </table>
      <table role="presentation" width="${BRAND.emailMaxWidth}" cellpadding="0" cellspacing="0" border="0" style="max-width:${BRAND.emailMaxWidth}px;">
        <tr><td align="center" style="padding:20px 24px 0;">
          <a href="${BRAND.studioWebsite}" style="font-family:${BRAND.fontBody};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${BRAND.cream};opacity:0.7;text-decoration:none;">${websiteLabel}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
