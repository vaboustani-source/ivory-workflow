// Shared definitions for the block-based contract builder.
import type { Database } from "@/integrations/supabase/types";

export type BlockType = Database["public"]["Enums"]["contract_block_type"];

export type SignerRole = "partner_1" | "partner_2" | "photographer";

export const SIGNER_ROLE_LABELS: Record<SignerRole, string> = {
  partner_1: "Primary client",
  partner_2: "Alternate client",
  photographer: "Photographer",
};

export interface BlockOption { value: string; label: string }

export interface BlockConfigMap {
  text_box: { content: string };
  image: { url: string; alt: string; width?: number };
  divider: { style: "solid" | "dashed" | "gold" };
  spacer: { size: "small" | "medium" | "large" };
  short_answer: { label: string; helper?: string; required: boolean; placeholder?: string; placeholder_key?: string };
  free_response: { label: string; helper?: string; required: boolean; placeholder?: string; max_length?: number };
  date_select: { label: string; helper?: string; required: boolean; min_date?: string; max_date?: string };
  initials: { label: string; signer_role: SignerRole; required: boolean };
  signature: { signer_role: SignerRole; required: boolean; show_typed_name: boolean; show_date: boolean };
  dropdown: { label: string; helper?: string; required: boolean; options: BlockOption[] };
  checkboxes: { label: string; helper?: string; required: boolean; options: BlockOption[]; min_selections?: number; max_selections?: number };
  multiple_choice: { label: string; helper?: string; required: boolean; options: BlockOption[] };
}

export type BlockConfigFor<T extends BlockType> = BlockConfigMap[T];

export interface ContractBlock {
  id: string;
  position: number;
  block_type: BlockType;
  config: any;
  content: string | null;
  signer_role?: string | null;
}

export const BLOCK_LIBRARY: { type: BlockType; label: string; group: "Display" | "Form" | "Signing" }[] = [
  { type: "text_box", label: "Text", group: "Display" },
  { type: "image", label: "Image", group: "Display" },
  { type: "divider", label: "Divider", group: "Display" },
  { type: "spacer", label: "Spacer", group: "Display" },
  { type: "short_answer", label: "Short answer", group: "Form" },
  { type: "free_response", label: "Free response", group: "Form" },
  { type: "date_select", label: "Date select", group: "Form" },
  { type: "dropdown", label: "Dropdown", group: "Form" },
  { type: "multiple_choice", label: "Multiple choice", group: "Form" },
  { type: "checkboxes", label: "Checkboxes", group: "Form" },
  { type: "initials", label: "Initials", group: "Signing" },
  { type: "signature", label: "Signature", group: "Signing" },
];

export function defaultConfig(type: BlockType): any {
  switch (type) {
    case "text_box": return { content: "<p>New text block.</p>" };
    case "image": return { url: "", alt: "" };
    case "divider": return { style: "solid" };
    case "spacer": return { size: "medium" };
    case "short_answer": return { label: "Question", required: false };
    case "free_response": return { label: "Question", required: false };
    case "date_select": return { label: "Pick a date", required: false };
    case "initials": return { label: "I have read and agree", signer_role: "partner_1", required: true };
    case "signature": return { signer_role: "partner_1", required: true, show_typed_name: true, show_date: true };
    case "dropdown": return { label: "Choose one", required: false, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
    case "checkboxes": return { label: "Select all that apply", required: false, options: [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }] };
    case "multiple_choice": return { label: "Choose one", required: false, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
  }
}

export function defaultContent(type: BlockType, config: any): string | null {
  if (type === "text_box") return config?.content ?? "";
  return null;
}
