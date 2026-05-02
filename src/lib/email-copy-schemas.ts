// Frontend mirror of supabase/functions/_emails/copy_schemas.ts.
// Kept in sync manually — only the words live here, no rendering logic.

export interface CopyFieldDef {
  key: string;
  label: string;
  helper?: string;
  type: "short_text" | "long_text" | "button_label" | "subject";
  defaultValue: string;
  supportsPlaceholders: boolean;
}

export interface EmailCopySchema {
  emailType: string;
  displayName: string;
  description: string;
  availablePlaceholders: string[];
  fields: CopyFieldDef[];
}

export const EMAIL_COPY_SCHEMAS: Record<string, EmailCopySchema> = {
  portal_invite: {
    emailType: "portal_invite",
    displayName: "Portal Invitation",
    description: "Sent when a couple is invited to their planning portal.",
    availablePlaceholders: ["couple_first_names", "couple_full_names", "studio_name"],
    fields: [
      { key: "subject", label: "Subject line", type: "subject", defaultValue: "Welcome to your wedding portal — Stories by Victoria", supportsPlaceholders: false },
      { key: "subject_resend", label: "Subject (resend)", helper: "Used when re-sending an existing invite", type: "subject", defaultValue: "A reminder: your Stories by Victoria portal awaits", supportsPlaceholders: false },
      { key: "heading", label: "Greeting", helper: "Italic Playfair line at the top of the email", type: "short_text", defaultValue: "Welcome to your story.", supportsPlaceholders: true },
      { key: "heading_resend", label: "Greeting (resend)", type: "short_text", defaultValue: "Hi {couple_first_names},", supportsPlaceholders: true },
      { key: "body", label: "Body paragraph", type: "long_text", defaultValue: "We're so glad you're here. We've prepared a quiet, beautiful space for you to walk through your wedding photography journey with us — every milestone, every detail, every memory.", supportsPlaceholders: true },
      { key: "body_resend", label: "Body (resend)", type: "long_text", defaultValue: "Just a gentle reminder — your private planning portal is ready whenever you're ready to dive in.", supportsPlaceholders: true },
      { key: "button_label", label: "Button text", type: "button_label", defaultValue: "Open your portal", supportsPlaceholders: false },
      { key: "expiry_note", label: "Expiry note", helper: "Small text below the button", type: "short_text", defaultValue: "This link expires in 7 days. If you didn't expect this invitation, please ignore this email.", supportsPlaceholders: false },
    ],
  },
  message_notification: {
    emailType: "message_notification",
    displayName: "New Message",
    description: "Sent when the studio sends a message and the couple is offline.",
    availablePlaceholders: ["couple_first_names", "sender_name", "studio_name"],
    fields: [
      { key: "subject", label: "Subject line", type: "subject", defaultValue: "New message from {sender_name} — Stories by Victoria", supportsPlaceholders: true },
      { key: "subject_mentioned", label: "Subject (when @mentioned)", type: "subject", defaultValue: "{sender_name} mentioned you — Stories by Victoria", supportsPlaceholders: true },
      { key: "heading", label: "Greeting", type: "short_text", defaultValue: "A new message from {sender_name}.", supportsPlaceholders: true },
      { key: "heading_mentioned", label: "Greeting (when @mentioned)", type: "short_text", defaultValue: "{sender_name} mentioned you.", supportsPlaceholders: true },
      { key: "button_label", label: "Button text", type: "button_label", defaultValue: "Open in Studio", supportsPlaceholders: false },
    ],
  },
  contract_sent: {
    emailType: "contract_sent",
    displayName: "Contract Sent",
    description: "Sent when a contract is sent to a couple to review and sign.",
    availablePlaceholders: ["couple_first_names", "studio_name", "contract_title"],
    fields: [
      { key: "subject", label: "Subject line", type: "subject", defaultValue: "Your contract is ready — Stories by Victoria", supportsPlaceholders: false },
      { key: "heading", label: "Greeting", type: "short_text", defaultValue: "Hi {couple_first_names},", supportsPlaceholders: true },
      { key: "body", label: "Body paragraph", type: "long_text", defaultValue: "Your wedding photography contract is ready to review and sign. Take your time — we're here whenever you have questions.", supportsPlaceholders: true },
      { key: "button_label", label: "Button text", type: "button_label", defaultValue: "Review & sign", supportsPlaceholders: false },
    ],
  },
  form_sent: {
    emailType: "form_sent",
    displayName: "Form Sent",
    description: "Sent when a questionnaire is sent to a couple.",
    availablePlaceholders: ["couple_first_names", "studio_name", "form_title"],
    fields: [
      { key: "subject", label: "Subject line", type: "subject", defaultValue: "We have a few questions for you — Stories by Victoria", supportsPlaceholders: false },
      { key: "heading", label: "Greeting", type: "short_text", defaultValue: "Hi {couple_first_names},", supportsPlaceholders: true },
      { key: "body", label: "Body paragraph", type: "long_text", defaultValue: "When you have a moment, would you mind answering a few questions? It helps us prepare for your day.", supportsPlaceholders: true },
      { key: "button_label", label: "Button text", type: "button_label", defaultValue: "Open form", supportsPlaceholders: false },
    ],
  },
  contract_receipt: {
    emailType: "contract_receipt",
    displayName: "Contract Receipt",
    description: "Sent automatically when a couple signs a contract — confirmation with audit details.",
    availablePlaceholders: ["couple_first_names", "couple_full_names", "studio_name", "contract_title", "signer_name"],
    fields: [
      { key: "subject", label: "Subject line", type: "subject", defaultValue: "Your signed contract — Stories by Victoria", supportsPlaceholders: false },
      { key: "heading", label: "Greeting", type: "short_text", defaultValue: "Hi {couple_first_names},", supportsPlaceholders: true },
      { key: "body_1", label: "First paragraph", type: "long_text", defaultValue: "Thank you. Your contract has been signed and recorded.", supportsPlaceholders: true },
      { key: "body_2", label: "Second paragraph", type: "long_text", defaultValue: "We've kept a copy in your portal — you can view it anytime under Documents.", supportsPlaceholders: true },
    ],
  },
};

export const EMAIL_TYPE_ORDER: string[] = [
  "portal_invite",
  "message_notification",
  "contract_sent",
  "form_sent",
  "contract_receipt",
];
