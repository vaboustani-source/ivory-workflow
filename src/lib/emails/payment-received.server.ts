// Server-only renderer for the payment_received transactional email.
// Self-contained — no Deno imports so it works inside the TanStack Worker
// runtime (the existing supabase/functions/_emails/* tree is Deno-only).
//
// Brand: ivory cream background, Playfair serif headings, Inter body,
// deep green emphasis (#103200). No images, no CTAs — pure transactional
// confirmation per Stage 6 spec.

export interface PaymentReceivedInput {
  coupleName1: string;
  coupleName2: string | null;
  amountCents: number;
  invoiceLabel: string;
  sequenceOrder: number | null;
  totalInvoiceCount: number;
  dateReceived: Date;
  remainingBalanceCents: number;
  weddingDate: string | null; // ISO date 'YYYY-MM-DD'
}

export interface PaymentReceivedOutput {
  subject: string;
  htmlBody: string;
  textBody: string;
}

const BRAND = {
  cream: "#F5EDE6",
  ivoryDeep: "#EBDBC8",
  green: "#103200",
  textPrimary: "#2A1820",
  textMuted: "#7A6B70",
  footerMuted: "#9A8E92",
  hairline: "#E0D2C2",
  fontHeadings: "'Playfair Display', Georgia, 'Times New Roman', serif",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  studioName: "Stories by Victoria",
  studioEmail: "studio@victoriaboustani.com",
  studioWebsite: "victoriaboustani.com",
  fontHeadingsUrl:
    "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap",
  fontBodyUrl:
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatWeddingDate(iso: string | null): string | null {
  if (!iso) return null;
  // Parse 'YYYY-MM-DD' as UTC midnight to avoid TZ drift
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return formatLongDate(new Date(Date.UTC(y, m - 1, d)));
}

function firstNames(n1: string, n2: string | null): string {
  if (n2 && n2.trim()) return `${n1.trim()} and ${n2.trim()}`;
  return n1.trim();
}

function pickWarmthLine(
  input: PaymentReceivedInput,
  weddingDateFormatted: string | null,
): string {
  const isRetainer =
    input.sequenceOrder === 1 || /retainer/i.test(input.invoiceLabel);
  const isPaidInFull = input.remainingBalanceCents === 0;

  if (isPaidInFull && !isRetainer) {
    if (weddingDateFormatted) {
      return `Everything is settled. ${weddingDateFormatted} is going to be a beautiful day.`;
    }
    return "Everything is settled. It's going to be a beautiful day.";
  }
  if (isRetainer) {
    if (weddingDateFormatted) {
      return `We're so glad to officially be on your team. Your wedding date — ${weddingDateFormatted} — is now firmly on our calendar.`;
    }
    return "We're so glad to officially be on your team.";
  }
  // Middle installment
  if (weddingDateFormatted) {
    return `${weddingDateFormatted} is getting closer. We'll be in touch as the wedding approaches.`;
  }
  return "We'll be in touch as the wedding approaches.";
}

export function renderPaymentReceived(
  input: PaymentReceivedInput,
): PaymentReceivedOutput {
  const names = firstNames(input.coupleName1, input.coupleName2);
  const amount = formatMoney(input.amountCents);
  const dateStr = formatLongDate(input.dateReceived);
  const weddingFormatted = formatWeddingDate(input.weddingDate);
  const warmthLine = pickWarmthLine(input, weddingFormatted);

  const showSequence =
    input.totalInvoiceCount >= 3 && input.sequenceOrder != null;
  const sequenceContext = showSequence
    ? `Installment ${input.sequenceOrder} of ${input.totalInvoiceCount}`
    : null;

  const remainingLine =
    input.remainingBalanceCents === 0
      ? "Paid in full — congratulations."
      : formatMoney(input.remainingBalanceCents);

  const subject = `Payment received — thank you, ${names}`;

  // ── HTML ───────────────────────────────────────────────────────────────
  const detail = (label: string, value: string) => `
    <tr>
      <td style="font-family:${BRAND.fontBody};font-size:14px;line-height:1.6;color:${BRAND.textPrimary};padding:3px 0;">
        <span style="color:${BRAND.textMuted};">·</span>
        <strong style="font-weight:500;color:${BRAND.green};">${escapeHtml(label)}:</strong>
        <span style="color:${BRAND.textPrimary};">&nbsp;${escapeHtml(value)}</span>
      </td>
    </tr>`;

  const forValue = sequenceContext
    ? `${input.invoiceLabel} · ${sequenceContext}`
    : input.invoiceLabel;

  const contentRows = [
    detail("Amount", amount),
    detail("For", forValue),
    detail("Date received", dateStr),
    detail("Remaining balance", remainingLine),
  ].join("");

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>Payment received — ${escapeHtml(BRAND.studioName)}</title>
<link href="${BRAND.fontHeadingsUrl}" rel="stylesheet" />
<link href="${BRAND.fontBodyUrl}" rel="stylesheet" />
<style>
  @media only screen and (max-width: 620px) {
    .sbv-card { width: 100% !important; }
    .sbv-pad { padding-left: 28px !important; padding-right: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.ivoryDeep};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">Payment of ${escapeHtml(amount)} received — thank you.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivoryDeep};padding:40px 16px;">
<tr><td align="center">
  <table role="presentation" class="sbv-card" width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};max-width:600px;border-radius:4px;">
    <tr><td class="sbv-pad" style="padding:48px 56px 8px;">
      <p style="font-family:${BRAND.fontBody};font-size:15px;line-height:1.7;color:${BRAND.textPrimary};margin:0 0 20px;">
        ${escapeHtml(names)},
      </p>
      <p style="font-family:${BRAND.fontBody};font-size:15px;line-height:1.7;color:${BRAND.textPrimary};margin:0 0 24px;">
        Your payment of <strong style="color:${BRAND.green};font-weight:500;">${escapeHtml(amount)}</strong> for the ${escapeHtml(input.invoiceLabel)} has been received. Thank you.
      </p>
      <p style="font-family:${BRAND.fontBody};font-size:14px;line-height:1.6;color:${BRAND.textMuted};margin:0 0 12px;">
        A few details for your records:
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
        ${contentRows}
      </table>
      <p style="font-family:${BRAND.fontHeadings};font-style:italic;font-size:17px;line-height:1.5;color:${BRAND.green};margin:0 0 24px;">
        ${escapeHtml(warmthLine)}
      </p>
      <p style="font-family:${BRAND.fontBody};font-size:14px;line-height:1.7;color:${BRAND.textPrimary};margin:0 0 28px;">
        If you have any questions, just reply to this email — it lands in our studio inbox.
      </p>
      <p style="font-family:${BRAND.fontHeadings};font-style:italic;font-size:16px;line-height:1.5;color:${BRAND.textPrimary};margin:0 0 8px;">
        With care,
      </p>
      <p style="font-family:${BRAND.fontHeadings};font-style:italic;font-size:16px;line-height:1.5;color:${BRAND.textPrimary};margin:0 0 40px;">
        Victoria &amp; the ${escapeHtml(BRAND.studioName)} team
      </p>
    </td></tr>
    <tr><td class="sbv-pad" style="padding:0 56px 36px;">
      <div style="border-top:1px solid ${BRAND.hairline};padding-top:18px;">
        <p style="font-family:${BRAND.fontBody};font-size:11px;line-height:1.6;color:${BRAND.footerMuted};margin:0;text-align:center;">
          ${escapeHtml(BRAND.studioName)} · ${escapeHtml(BRAND.studioEmail)} · ${escapeHtml(BRAND.studioWebsite)}
        </p>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  // ── PLAIN-TEXT ─────────────────────────────────────────────────────────
  const detailLines = [
    `· Amount: ${amount}`,
    `· For: ${forValue}`,
    `· Date received: ${dateStr}`,
    `· Remaining balance: ${remainingLine}`,
  ].join("\n");

  const textBody = [
    `${names},`,
    ``,
    `Your payment of ${amount} for the ${input.invoiceLabel} has been received. Thank you.`,
    ``,
    `A few details for your records:`,
    ``,
    detailLines,
    ``,
    warmthLine,
    ``,
    `If you have any questions, just reply to this email — it lands in our studio inbox.`,
    ``,
    `With care,`,
    ``,
    `Victoria & the ${BRAND.studioName} team`,
    ``,
    `—`,
    `${BRAND.studioName} · ${BRAND.studioEmail} · ${BRAND.studioWebsite}`,
  ].join("\n");

  return { subject, htmlBody, textBody };
}
