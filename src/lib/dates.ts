// Editorial date formatting utilities
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Saturday, the 25th of April." */
export function editorialDate(d: Date = new Date()): string {
  return `${WEEKDAYS[d.getDay()]}, the ${ordinal(d.getDate())} of ${MONTHS[d.getMonth()]}.`;
}

/** "Jun 14, 2026" */
export function shortDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "3 days ago", "yesterday", "today" */
export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return "Never";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "Never";
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const future = Math.abs(diffDays);
    if (future === 0) return "today";
    if (future === 1) return "tomorrow";
    return `in ${future} days`;
  }
  if (diffDays === 0) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return "just now";
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(diffDays / 365)} year${diffDays >= 730 ? "s" : ""} ago`;
}

export function daysBetween(target: string | Date | null | undefined): number | null {
  if (!target) return null;
  const d = typeof target === "string" ? new Date(target) : target;
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  return full.trim().split(/\s+/)[0];
}
