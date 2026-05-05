/** Convert a due date into a friendly "when" framing. */
export function whenLabel(dueDate: string | null | undefined): string {
  if (!dueDate) return "Soon";
  const d = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "Overdue";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return "Next week";
  if (diffDays <= 30) return `In ${Math.ceil(diffDays / 7)} weeks`;
  return `In ${target.toLocaleString("en-US", { month: "long" })}`;
}

/** Pick a CTA verb based on the client_facing_label. */
export function ctaForLabel(label?: string | null): string {
  if (!label) return "Open";
  const lower = label.toLowerCase();
  if (lower.includes("sign") && lower.includes("contract")) return "Sign contract";
  if (lower.includes("fill out")) return "Fill out form";
  if (lower.includes("gallery")) return "View gallery";
  if (lower.includes("retainer") || lower.includes("invoice") || lower.includes("pay")) return "Pay invoice";
  if (lower.includes("portrait")) return "Review list";
  if (lower.includes("engagement")) return "Plan session";
  if (lower.includes("sneak")) return "Open";
  return "Open";
}
