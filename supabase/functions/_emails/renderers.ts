// Shared HTML body builders for each transactional email type.
// Brand shell stays in template.ts; this file glues editable copy + structural layout.
//
// Each builder takes:
//   - overrides: copy overrides loaded from email_template_copy (or live edits in preview)
//   - ctx: placeholder context (couple_first_names, sender_name, etc.)
//   - extras: per-email runtime extras (link, message preview, audit details, etc.)
//
// Returns { subject, preheader, contentHtml } — the caller wraps with renderEmailTemplate.

import { renderEmailTemplate } from "./template.ts";
import {
  heading,
  paragraph,
  paragraphRich,
  button,
  noteBlock,
  smallLabel,
  divider,
  detailRow,
  escapeHtml,
} from "./components.ts";
import { BRAND } from "./brand.ts";
import {
  EMAIL_COPY_SCHEMAS,
  resolveCopy,
  renderPlaceholders,
  EmailCopySchema,
} from "./copy_schemas.ts";

type Overrides = Record<string, string> | null | undefined;
type Ctx = Record<string, string | null | undefined>;

function r(schema: EmailCopySchema, key: string, overrides: Overrides, ctx: Ctx): string {
  return renderPlaceholders(resolveCopy(schema, key, overrides), ctx);
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

// ─── PORTAL INVITE ───────────────────────────────────────────────────────────
export interface PortalInviteExtras {
  link: string;
  variant?: "initial" | "resend" | "partner";
  partnerCoupleNames?: string; // used only for partner variant (special preheader)
}

export function buildPortalInvite(
  overrides: Overrides,
  ctx: Ctx,
  extras: PortalInviteExtras,
): RenderedEmail {
  const schema = EMAIL_COPY_SCHEMAS.portal_invite;
  const variant = extras.variant ?? "initial";
  const isResend = variant === "resend";
  const isPartner = variant === "partner";

  // Partner variant uses its own subject/heading because that flow is structurally different.
  let subject: string;
  let headingText: string;
  let bodyText: string;
  if (isPartner) {
    subject = `Your partner invited you to your wedding portal — ${BRAND.studioName}`;
    headingText = "Join your partner on this journey.";
    const partnerNames = extras.partnerCoupleNames ?? ctx.couple_full_names ?? "";
    bodyText = `You've been invited to join the wedding portal for ${partnerNames}. We've prepared a quiet, beautiful space to walk through every step of your photography journey together.`;
  } else if (isResend) {
    subject = r(schema, "subject_resend", overrides, ctx);
    headingText = r(schema, "heading_resend", overrides, ctx);
    bodyText = r(schema, "body_resend", overrides, ctx);
  } else {
    subject = r(schema, "subject", overrides, ctx);
    headingText = r(schema, "heading", overrides, ctx);
    bodyText = r(schema, "body", overrides, ctx);
  }

  const buttonLabel = r(schema, "button_label", overrides, ctx);
  const expiryNote = r(schema, "expiry_note", overrides, ctx);

  const contentHtml = `
    ${heading(headingText)}
    ${isPartner ? paragraphRich(escapeHtml(bodyText)) : paragraph(bodyText)}
    ${button(buttonLabel, extras.link)}
    <p style="font-family:${BRAND.fontBody};color:${BRAND.textSecondary};font-size:12px;line-height:1.5;margin:8px 0 0;text-align:center;">${escapeHtml(expiryNote)}</p>
  `;

  const preheader = isPartner
    ? `You've been invited to ${extras.partnerCoupleNames ?? "your partner's"} wedding portal.`
    : isResend
    ? "A reminder of your private planning portal."
    : "Your private wedding planning portal awaits.";

  return {
    subject,
    html: renderEmailTemplate({ preheader, contentHtml }),
  };
}

// ─── MESSAGE NOTIFICATION ────────────────────────────────────────────────────
export interface MessageNotificationExtras {
  link: string;
  messagePreview: string; // raw text
  isMentioned?: boolean;
  reLabel: string; // e.g. "Re: Sarah & James"
}

export function buildMessageNotification(
  overrides: Overrides,
  ctx: Ctx,
  extras: MessageNotificationExtras,
): RenderedEmail {
  const schema = EMAIL_COPY_SCHEMAS.message_notification;
  const subjectKey = extras.isMentioned ? "subject_mentioned" : "subject";
  const headingKey = extras.isMentioned ? "heading_mentioned" : "heading";

  const subject = r(schema, subjectKey, overrides, ctx);
  const headingText = r(schema, headingKey, overrides, ctx);
  const buttonLabel = r(schema, "button_label", overrides, ctx);

  const previewSafe =
    escapeHtml(extras.messagePreview.slice(0, 200)).replace(/\n/g, "<br/>") +
    (extras.messagePreview.length > 200 ? "…" : "");

  const contentHtml = `
    ${heading(headingText)}
    ${smallLabel(extras.reLabel)}
    ${noteBlock(previewSafe)}
    ${button(buttonLabel, extras.link)}
  `;

  const preheader = `${ctx.sender_name ?? ""}: ${extras.messagePreview.slice(0, 80)}${extras.messagePreview.length > 80 ? "…" : ""}`;

  return { subject, html: renderEmailTemplate({ preheader, contentHtml }) };
}

// ─── CONTRACT SENT ───────────────────────────────────────────────────────────
export interface ContractSentExtras {
  link: string;
  personalNote?: string;
}

export function buildContractSent(
  overrides: Overrides,
  ctx: Ctx,
  extras: ContractSentExtras,
): RenderedEmail {
  const schema = EMAIL_COPY_SCHEMAS.contract_sent;
  const subject = r(schema, "subject", overrides, ctx);
  const headingText = r(schema, "heading", overrides, ctx);
  const bodyText = r(schema, "body", overrides, ctx);
  const buttonLabel = r(schema, "button_label", overrides, ctx);

  const noteHtml = extras.personalNote
    ? noteBlock(escapeHtml(extras.personalNote).replace(/\n/g, "<br/>"))
    : "";

  const contentHtml = `
    ${heading(headingText)}
    ${paragraph(bodyText)}
    ${noteHtml}
    ${button(buttonLabel, extras.link)}
  `;

  return {
    subject,
    html: renderEmailTemplate({ preheader: bodyText.slice(0, 100), contentHtml }),
  };
}

// ─── FORM SENT ───────────────────────────────────────────────────────────────
export interface FormSentExtras {
  link: string;
  personalNote?: string;
}

export function buildFormSent(
  overrides: Overrides,
  ctx: Ctx,
  extras: FormSentExtras,
): RenderedEmail {
  const schema = EMAIL_COPY_SCHEMAS.form_sent;
  const subject = r(schema, "subject", overrides, ctx);
  const headingText = r(schema, "heading", overrides, ctx);
  const bodyText = r(schema, "body", overrides, ctx);
  const buttonLabel = r(schema, "button_label", overrides, ctx);

  const noteHtml = extras.personalNote
    ? noteBlock(escapeHtml(extras.personalNote).replace(/\n/g, "<br/>"))
    : "";

  const contentHtml = `
    ${heading(headingText)}
    ${paragraph(bodyText)}
    ${noteHtml}
    ${button(buttonLabel, extras.link)}
  `;

  return {
    subject,
    html: renderEmailTemplate({ preheader: bodyText.slice(0, 100), contentHtml }),
  };
}

// ─── CONTRACT RECEIPT ────────────────────────────────────────────────────────
export interface ContractReceiptExtras {
  contractTitle: string;
  signedAtFormatted: string;
  ipAddress: string;
  signerName: string;
}

export function buildContractReceipt(
  overrides: Overrides,
  ctx: Ctx,
  extras: ContractReceiptExtras,
): RenderedEmail {
  const schema = EMAIL_COPY_SCHEMAS.contract_receipt;
  const subject = r(schema, "subject", overrides, ctx);
  const headingText = r(schema, "heading", overrides, ctx);
  const body1 = r(schema, "body_1", overrides, ctx);
  const body2 = r(schema, "body_2", overrides, ctx);

  const contentHtml = `
    ${heading(headingText)}
    ${paragraph(body1)}
    ${paragraph(body2)}
    ${divider()}
    ${smallLabel("Signature details")}
    ${detailRow("Signed by", extras.signerName)}
    ${detailRow("Date", extras.signedAtFormatted)}
    ${detailRow("Contract", extras.contractTitle)}
    ${detailRow("IP recorded", extras.ipAddress)}
  `;

  return {
    subject,
    html: renderEmailTemplate({
      preheader: "Your contract has been signed and recorded.",
      contentHtml,
    }),
  };
}

// ─── DISPATCHER (used by render-email-preview) ───────────────────────────────
export type EmailType =
  | "portal_invite"
  | "message_notification"
  | "contract_sent"
  | "form_sent"
  | "contract_receipt";

export function buildPreviewEmail(
  type: EmailType,
  overrides: Overrides,
  ctx: Ctx,
): RenderedEmail {
  const sampleLink = "https://example.com/portal";
  switch (type) {
    case "portal_invite":
      return buildPortalInvite(overrides, ctx, {
        link: sampleLink,
        variant: "initial",
      });
    case "message_notification":
      return buildMessageNotification(overrides, ctx, {
        link: sampleLink,
        isMentioned: false,
        reLabel: `Re: ${ctx.couple_full_names ?? ""}`,
        messagePreview:
          "Just wanted to share a few quick thoughts after our call today — I loved hearing about the chapel ceremony and the family dinner. I'll start sketching out the timeline tomorrow.",
      });
    case "contract_sent":
      return buildContractSent(overrides, ctx, {
        link: sampleLink,
        personalNote:
          "We had such a beautiful conversation today — can't wait to capture your day.",
      });
    case "form_sent":
      return buildFormSent(overrides, ctx, { link: sampleLink });
    case "contract_receipt":
      return buildContractReceipt(overrides, ctx, {
        contractTitle: ctx.contract_title ?? "Wedding Photography Agreement",
        signerName: ctx.signer_name ?? "Sarah Mitchell",
        signedAtFormatted: new Date().toLocaleString("en-US", {
          dateStyle: "long",
          timeStyle: "short",
        }) + " UTC",
        ipAddress: "203.0.113.42",
      });
  }
}
