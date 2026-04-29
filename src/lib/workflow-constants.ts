// Constants and labels for the SBV workflow editor.

export const WORKFLOW_STAGES = [
  "inquiry",
  "welcome",
  "engagement",
  "pre_wedding",
  "wedding_week",
  "post_wedding",
  "album",
  "long_tail",
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  welcome: "Welcome",
  engagement: "Engagement",
  pre_wedding: "Pre-Wedding",
  wedding_week: "Wedding Week",
  post_wedding: "Post-Wedding",
  album: "Album",
  long_tail: "Long Tail",
};

export const ACTION_TYPES = [
  "create_task",
  "draft_email",
  "show_portal_item",
  "send_questionnaire",
  "send_invoice",
  "status_change",
  "reminder",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABELS: Record<string, string> = {
  create_task: "Create task",
  draft_email: "Draft email",
  show_portal_item: "Show portal item",
  send_questionnaire: "Send questionnaire",
  send_invoice: "Send invoice",
  status_change: "Status change",
  reminder: "Reminder",
};

export const ACTION_CHIP_CLASS: Record<string, string> = {
  create_task: "bg-sage/20 text-sage-foreground",
  draft_email: "bg-gold/20 text-plum",
  show_portal_item: "bg-plum/20 text-plum",
  send_questionnaire: "bg-plum/15 text-plum",
  send_invoice: "bg-magenta/15 text-magenta",
  status_change: "bg-primary/15 text-primary",
  reminder: "bg-muted text-muted-foreground",
};

export const RESPONSIBLE_PARTIES = [
  "system",
  "owner",
  "manager",
  "associate",
  "client",
] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

export const RESPONSIBLE_LABELS: Record<string, string> = {
  system: "System",
  owner: "Owner",
  manager: "Manager",
  associate: "Associate",
  client: "Client",
};

export const TRIGGER_TYPES = ["relative_date", "event", "manual"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_RELATIVE_TO = [
  "wedding_date",
  "booking_date",
  "engagement_session_date",
  "gallery_delivery_date",
  "album_workflow_activated_at",
  "previous_step",
  "proposal_valid_until",
] as const;
export type TriggerRelativeTo = (typeof TRIGGER_RELATIVE_TO)[number];

export const ANCHOR_LABELS: Record<string, string> = {
  wedding_date: "Wedding date",
  booking_date: "Booking date",
  engagement_session_date: "Engagement session date",
  gallery_delivery_date: "Gallery delivery date",
  album_workflow_activated_at: "Album activation date",
  previous_step: "Previous step",
  proposal_valid_until: "Proposal valid until",
};

export const TRIGGER_EVENTS = [
  "booked",
  "contract_signed",
  "retainer_paid",
  "proposal_sent",
  "proposal_accepted",
  "engagement_session_scheduled",
  "album_workflow_activated",
] as const;

export const BRANCHES = [
  "always",
  "has_engagement",
  "has_videography",
  "has_album",
  "has_album_active",
  "NOT_has_album_purchased",
] as const;
export type Branch = (typeof BRANCHES)[number];

export const BRANCH_LABELS: Record<string, string> = {
  always: "Always",
  has_engagement: "Has engagement",
  has_videography: "Has videography",
  has_album: "Has album",
  has_album_active: "Has album active",
  NOT_has_album_purchased: "Has album NOT purchased",
};

export const BRANCH_PILL_LABELS: Record<string, string> = {
  has_engagement: "ENGAGEMENT ONLY",
  has_videography: "VIDEOGRAPHY ONLY",
  has_album: "ALBUM ONLY",
  has_album_active: "ALBUM ACTIVE",
  NOT_has_album_purchased: "NO ALBUM",
};

export const EMAIL_TEMPLATE_STAGES = [
  "inquiry",
  "welcome",
  "engagement",
  "pre_wedding",
  "post_wedding",
  "album",
  "long_tail",
] as const;

export const MERGE_FIELDS: { field: string; description: string; sample: string }[] = [
  { field: "{couple_first_names}", description: "Couple's first names", sample: "Sarah & James" },
  { field: "{couple_full_names}", description: "Couple's full names", sample: "Sarah Johnson & James Miller" },
  { field: "{wedding_date_long}", description: "Wedding date, long form", sample: "Saturday, June 14, 2026" },
  { field: "{wedding_date_short}", description: "Wedding date, short form", sample: "Jun 14, 2026" },
  { field: "{days_until_wedding}", description: "Days until the wedding", sample: "147" },
  { field: "{venue_name}", description: "Venue name", sample: "The Old Mill" },
  { field: "{photographer_name}", description: "Lead photographer", sample: "Victoria" },
  { field: "{studio_email}", description: "Studio email address", sample: "hello@victoriaboustani.com" },
  { field: "{studio_signature}", description: "Studio sign-off", sample: "with care, Stories by Victoria" },
  { field: "{portal_url}", description: "Couple's portal home", sample: "(portal link)" },
  { field: "{logistics_form_url}", description: "Logistics form link", sample: "(logistics form link)" },
  { field: "{gallery_url}", description: "Delivered gallery link", sample: "(gallery link)" },
  { field: "{sneak_peek_url}", description: "Sneak peek post link", sample: "(sneak peek link)" },
];

export function substituteSample(text: string): string {
  let out = text || "";
  for (const m of MERGE_FIELDS) out = out.split(m.field).join(m.sample);
  return out;
}
