// Pure function to compute the "Getting-Ready Cheat Sheet" lines from a
// photography timeline. No I/O — trivially unit-testable.
//
// Anchor rules:
//  - If the timeline has a first-look block, ANCHOR = first-look start.
//  - Otherwise ANCHOR = ceremony_start - 2h ("camera-ready" A = C - 2h).
//    (Getting-ready window is C-3h → C-2h. C-1h → C is buffer + details.)
//
// Cascade off ANCHOR:
//  - Get dressed by       = ANCHOR - dressingLead        (default 20 min)
//  - Glam done by         = dressed - glamBeforeDressing (default 30 min)
//  - Helper ready by      = dressed - helperBeforeDressing (default 30 min)
//  - Wedding party by     = wp block start - wpLead      (default 10 min)
//  - Family by            = family block start - familyLead (default 10 min)

export interface CheatSheetBlockLike {
  start: string;               // "HH:MM"
  end?: string;
  label: string;
  type?: string;
}

export interface CheatSheetTimeline {
  blocks: CheatSheetBlockLike[];
  ceremony_start_time?: string | null;
  has_first_look?: boolean | null;
  has_wedding_party?: boolean | null;
}

export interface GetReadyBuffers {
  dressingLead?: number;         // ANCHOR - dressed
  glamBeforeDressing?: number;   // dressed - glam
  helperBeforeDressing?: number; // dressed - helper
  wpLead?: number;               // wp block start - wp ready
  familyLead?: number;           // family block start - family ready
}

export const DEFAULT_BUFFERS: Required<GetReadyBuffers> = {
  dressingLead: 20,
  glamBeforeDressing: 30,
  helperBeforeDressing: 30,
  wpLead: 10,
  familyLead: 10,
};

export type GetReadyKey = "glam" | "dressed" | "helper" | "wedding_party" | "family";

export interface GetReadyLine {
  key: GetReadyKey;
  label: string;
  time: string | null;          // "HH:MM" or null when applies=false
  time12: string | null;        // "1:10 PM" for display
  applies: boolean;
  isOverridden: boolean;
  anchor: "first_look" | "camera_ready" | "wedding_party_block" | "family_block" | "none";
  note?: string;
}

export interface GetReadyResult {
  lines: GetReadyLine[];
  anchorMode: "first_look" | "no_first_look" | "missing";
  anchorTime: string | null;   // ANCHOR in HH:MM
  guidance?: string;
}

// ---------- time helpers ----------

const HHMM = /^(\d{1,2}):(\d{2})$/;

function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = HHMM.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mm) || h < 0 || h > 47 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function toHHMM(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function to12Hour(hhmm: string | null | undefined): string | null {
  const mins = toMins(hhmm ?? null);
  if (mins == null) return null;
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

// ---------- block matching ----------

function findBlock(blocks: CheatSheetBlockLike[], test: (b: CheatSheetBlockLike) => boolean): CheatSheetBlockLike | null {
  for (const b of blocks) if (test(b)) return b;
  return null;
}

function isFirstLookBlock(b: CheatSheetBlockLike): boolean {
  return /first\s*look/i.test(b.label ?? "");
}
function isWeddingPartyBlock(b: CheatSheetBlockLike): boolean {
  return /wedding\s*party/i.test(b.label ?? "");
}
function isFamilyBlock(b: CheatSheetBlockLike): boolean {
  const l = b.label ?? "";
  // "Wedding Party" mentions can also mention family — exclude those.
  if (/wedding\s*party/i.test(l)) return false;
  return /\b(family|formal|group\s*portraits?|group\s*shots?)\b/i.test(l);
}
function ceremonyBlockStart(blocks: CheatSheetBlockLike[]): string | null {
  const c = findBlock(blocks, (b) => b.type === "ceremony" || /ceremony/i.test(b.label ?? ""));
  return c?.start ?? null;
}

// ---------- main ----------

export interface ComputeInput {
  timeline: CheatSheetTimeline;
  buffers?: GetReadyBuffers;
  overrides?: Record<string, string | null | undefined>;
}

export function computeGetReadyNotes(input: ComputeInput): GetReadyResult {
  const buffers = { ...DEFAULT_BUFFERS, ...(input.buffers ?? {}) };
  const overrides = input.overrides ?? {};
  const blocks = input.timeline.blocks ?? [];

  // Resolve anchor.
  const firstLookBlock = findBlock(blocks, isFirstLookBlock);
  const wantsFirstLook = input.timeline.has_first_look ?? !!firstLookBlock;

  const ceremonyStartRaw = input.timeline.ceremony_start_time ?? ceremonyBlockStart(blocks);
  const ceremonyMins = toMins(ceremonyStartRaw);

  let anchorMins: number | null = null;
  let anchorMode: GetReadyResult["anchorMode"] = "missing";
  let guidance: string | undefined;

  if (firstLookBlock) {
    const fl = toMins(firstLookBlock.start);
    if (fl != null) {
      anchorMins = fl;
      anchorMode = "first_look";
    }
  } else if (wantsFirstLook && ceremonyMins != null) {
    // first-look expected but no block found — fall back to ceremony math
    anchorMins = ceremonyMins - 120;
    anchorMode = "no_first_look";
    guidance = "First look expected but no first-look block was found — using ceremony-based anchor.";
  } else if (ceremonyMins != null) {
    anchorMins = ceremonyMins - 120;
    anchorMode = "no_first_look";
  }

  if (anchorMins == null) {
    return {
      lines: [],
      anchorMode: "missing",
      anchorTime: null,
      guidance: "Set the ceremony time or add a first-look block to generate these notes.",
    };
  }

  const wpBlock = findBlock(blocks, isWeddingPartyBlock);
  const familyBlock = findBlock(blocks, isFamilyBlock);

  // ---- computed defaults ----
  const dressedComputed = anchorMins - buffers.dressingLead;
  const glamComputed = dressedComputed - buffers.glamBeforeDressing;
  const helperComputed = dressedComputed - buffers.helperBeforeDressing;

  const wpStart = toMins(wpBlock?.start ?? null);
  const wpAppliesRaw = (input.timeline.has_wedding_party ?? true) !== false;
  const wpApplies = wpAppliesRaw && wpBlock != null && wpStart != null;
  const wpComputed = wpApplies ? (wpStart as number) - buffers.wpLead : null;

  const famStart = toMins(familyBlock?.start ?? null);
  const familyApplies = familyBlock != null && famStart != null;
  const familyComputed = familyApplies ? (famStart as number) - buffers.familyLead : null;

  // ---- apply overrides ----
  function line(
    key: GetReadyKey,
    label: string,
    computed: number | null,
    applies: boolean,
    anchor: GetReadyLine["anchor"],
  ): GetReadyLine {
    const override = overrides[key];
    const overrideMins = override ? toMins(override) : null;
    const finalMins = overrideMins != null ? overrideMins : computed;
    const timeStr = finalMins != null ? toHHMM(finalMins) : null;
    return {
      key,
      label,
      time: applies ? timeStr : null,
      time12: applies ? to12Hour(timeStr) : null,
      applies,
      isOverridden: overrideMins != null,
      anchor,
    };
  }

  const lines: GetReadyLine[] = [
    line("glam", "Hair & makeup done by", glamComputed, true, anchorMode === "first_look" ? "first_look" : "camera_ready"),
    line("dressed", "Get dressed by", dressedComputed, true, anchorMode === "first_look" ? "first_look" : "camera_ready"),
    line("helper", "Whoever's helping you dress, ready by", helperComputed, true, anchorMode === "first_look" ? "first_look" : "camera_ready"),
    line("wedding_party", "Wedding party ready by", wpComputed, wpApplies, "wedding_party_block"),
    line("family", "Family ready by", familyComputed, familyApplies, "family_block"),
  ];

  return {
    lines,
    anchorMode,
    anchorTime: toHHMM(anchorMins),
    guidance,
  };
}
