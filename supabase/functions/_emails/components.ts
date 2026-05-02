// Reusable HTML blocks for email content.
// Each function returns inline-styled HTML compatible with email clients.
import { BRAND } from "./brand.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Italic editorial heading — opening line of a letter.
export function heading(text: string): string {
  return `<h1 style="font-family:${BRAND.fontHeadings};font-style:italic;font-weight:400;color:${BRAND.burgundy};font-size:26px;line-height:1.3;margin:0 0 16px;">${escapeHtml(text)}</h1>`;
}

// Body paragraph (escaped).
export function paragraph(text: string): string {
  return `<p style="font-family:${BRAND.fontBody};color:${BRAND.textPrimary};font-size:15px;line-height:1.65;margin:0 0 16px;">${escapeHtml(text)}</p>`;
}

// Body paragraph allowing safe inline HTML (use sparingly — caller must sanitize).
export function paragraphRich(html: string): string {
  return `<p style="font-family:${BRAND.fontBody};color:${BRAND.textPrimary};font-size:15px;line-height:1.65;margin:0 0 16px;">${html}</p>`;
}

// Burgundy CTA button (table-based for Outlook compat).
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
    <tr><td align="center" bgcolor="${BRAND.burgundy}" style="border-radius:4px;">
      <a href="${href}" style="display:inline-block;background:${BRAND.burgundy};color:${BRAND.cream};text-decoration:none;font-family:${BRAND.fontBody};font-size:14px;font-weight:500;letter-spacing:0.5px;padding:14px 32px;border-radius:4px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

// Gold-accent quote/note block — accepts pre-rendered safe HTML.
export function noteBlock(html: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
    <tr><td style="border-left:2px solid ${BRAND.gold};padding:10px 18px;background:${BRAND.cream};">
      <p style="font-family:${BRAND.fontHeadings};font-style:italic;color:${BRAND.textPrimary};font-size:14px;line-height:1.65;margin:0;white-space:pre-wrap;">${html}</p>
    </td></tr>
  </table>`;
}

// Hairline divider.
export function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${BRAND.hairline};margin:24px 0;" />`;
}

// Small caps section label.
export function smallLabel(text: string): string {
  return `<p style="font-family:${BRAND.fontBody};color:${BRAND.textSecondary};font-size:11px;text-transform:uppercase;letter-spacing:0.18em;margin:0 0 10px;">${escapeHtml(text)}</p>`;
}

// Key/value detail row.
export function detailRow(label: string, value: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px;">
    <tr>
      <td style="font-family:${BRAND.fontBody};font-size:13px;color:${BRAND.textSecondary};padding:4px 0;">${escapeHtml(label)}</td>
      <td align="right" style="font-family:${BRAND.fontBody};font-size:13px;color:${BRAND.textPrimary};padding:4px 0;">${escapeHtml(value)}</td>
    </tr>
  </table>`;
}
