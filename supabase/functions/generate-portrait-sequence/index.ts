// Edge Function: generate-portrait-sequence
// SBV canonical build-up-then-break-down family portrait sequence.
// Variants: married_together | divorced_friendly | divorced_separate | single_parent | deceased
// Each step = 1 min; +2 min if 7+ people; +4 min setup buffer per side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParentInfo { name?: string; deceased?: boolean; honor_in_photo?: boolean; }
interface SiblingEntry { name: string; has_partner?: boolean; partner_name?: string; has_kids?: boolean; }
interface FamilyData {
  parents_status?: string; // "married_together" | "divorced_friendly" | "divorced_separate" | "single_parent" | "deceased"
  parent_1?: ParentInfo;
  parent_2?: ParentInfo;
  step_parent_1?: string;
  step_parent_2?: string;
  siblings?: SiblingEntry[];
  grandparents?: string;
  notes?: string;
}

interface SequenceStep {
  order: number;
  label: string;
  people: string[];
  minutes: number;
  note?: string;
}

const SETUP_BUFFER_MIN = 4;

function minutesFor(people: string[]): number {
  return people.length >= 7 ? 3 : 1;
}

// Build the canonical sequence for ONE side (one parent unit).
// momName/dadName: the two parents on this side (one may be a step-parent for divorced-separate).
// Either may be undefined for single_parent. If a parent is "deceased", pass their name as undefined
// (their solo shot is skipped) but they remain absent from group shots.
function buildCanonicalSide(params: {
  subject: string;             // the partner whose family this is
  partner: string;             // the other half of the couple
  momName?: string;            // primary parent on this side (e.g. Mom or Dad-side dad)
  dadName?: string;            // secondary parent (e.g. Dad or step-parent). undefined if single/deceased.
  siblings: SiblingEntry[];
  sideLabel: string;           // for logging/labeling; e.g. "Mom side" or "Partner 1"
  honorDeceased?: { name?: string };
}): SequenceStep[] {
  const { subject, partner, momName, dadName, siblings, sideLabel, honorDeceased } = params;
  const steps: SequenceStep[] = [];
  let order = 0;
  const push = (label: string, people: string[], note?: string) => {
    const filtered = people.filter(Boolean);
    steps.push({ order: ++order, label, people: filtered, minutes: minutesFor(filtered), note });
  };

  if (!subject) return steps;
  if (!momName && !dadName && siblings.length === 0) return steps;

  const sibsClean = siblings.filter((s) => s?.name?.trim());
  const sibNames = sibsClean.map((s) => s.name.trim());
  const sibPartners = sibsClean
    .filter((s) => s.has_partner && s.partner_name?.trim())
    .map((s) => s.partner_name!.trim());

  // Step 1 & 2: subject + each parent solo (skip if deceased/missing)
  if (momName) push(`${subject} + ${momName}`, [subject, momName]);
  if (dadName) {
    if (momName) push(`Switch ${momName} for ${dadName}`, [subject, dadName]);
    else push(`${subject} + ${dadName}`, [subject, dadName]);
  }

  const parentsBoth = [momName, dadName].filter(Boolean) as string[];

  // Step 3: ^ Add the other parent → subject + parents
  if (parentsBoth.length >= 2) {
    push(`^ Add ${momName} (Parents + ${subject})`, [subject, ...parentsBoth]);
  }

  // Step 4: ^ Add Partner (Couple with Parents)
  if (parentsBoth.length > 0 && partner) {
    push(`^ Add ${partner} (Couple with Parents)`, [subject, partner, ...parentsBoth]);
  }

  // Steps 5..N: ^ Add each sibling (+ their partner) one at a time, building to full family
  let running = [subject, partner, ...parentsBoth].filter(Boolean) as string[];
  for (let i = 0; i < sibsClean.length; i++) {
    const sib = sibsClean[i];
    const addBits = [sib.name.trim()];
    let label = `^ Add ${sib.name.trim()}`;
    if (sib.has_partner && sib.partner_name?.trim()) {
      addBits.push(sib.partner_name.trim());
      label = `^ Add ${sib.name.trim()} + ${sib.partner_name.trim()}`;
    }
    running = [...running, ...addBits];
    const isLast = i === sibsClean.length - 1;
    push(isLast ? `${label} (Full Family)` : label, [...running], sib.has_kids ? "Include kids in family group?" : undefined);
  }

  // Step (peel 1): > Take out partners (couple's partner + sib partners) → OG Family
  if (sibsClean.length > 0 && (sibPartners.length > 0 || partner)) {
    push(
      `> Take out ${partner}${sibPartners.length ? " + sibling partners" : ""} (OG Family)`,
      [subject, ...parentsBoth, ...sibNames]
    );
  }

  // Step (peel 2): > Take out Parents (OG Siblings)
  if (sibsClean.length > 0 && parentsBoth.length > 0) {
    push(`> Take out Parents (OG Siblings)`, [subject, ...sibNames]);
  }

  // Step (rebuild): ^ Add back Partner + sibling partners (Sibs & Spouses)
  if (sibsClean.length > 0 && (partner || sibPartners.length > 0)) {
    push(
      `^ Add back ${partner}${sibPartners.length ? " + sibling partners" : ""} (Sibs & Spouses)`,
      [subject, partner, ...sibNames, ...sibPartners].filter(Boolean) as string[]
    );
  }

  // Final beat: parents alone
  if (parentsBoth.length >= 2) {
    push(`${momName} + ${dadName} (Parents alone)`, parentsBoth);
  } else if (parentsBoth.length === 1) {
    push(`${parentsBoth[0]} + ${subject} (final beat)`, [parentsBoth[0], subject]);
  }

  // Sib pair shots: each sibling + their partner
  for (const s of sibsClean) {
    if (s.has_partner && s.partner_name?.trim()) {
      push(`${s.name.trim()} + ${s.partner_name.trim()} (sib pair)`, [s.name.trim(), s.partner_name.trim()]);
    }
  }

  // Setup buffer
  push(`(${sideLabel}) Setup buffer`, []);
  steps[steps.length - 1].minutes = SETUP_BUFFER_MIN;

  // Honor deceased note (no shot)
  if (honorDeceased?.name) {
    push(`Moment of remembrance for ${honorDeceased.name}`, [], "No shot — plan a quiet moment.");
    steps[steps.length - 1].minutes = 0;
  }

  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

function buildForSide(coupleNames: string[], fam: FamilyData, sideIndex: 0 | 1): SequenceStep[] {
  const subject = coupleNames[sideIndex] ?? `Partner ${sideIndex + 1}`;
  const partner = coupleNames[1 - sideIndex] ?? "";
  const status = (fam.parents_status ?? "married_together").toLowerCase();
  const sibs = fam.siblings ?? [];
  const p1 = fam.parent_1?.name?.trim();
  const p2 = fam.parent_2?.name?.trim();
  const sideLabelBase = `Partner ${sideIndex + 1}`;

  // Divorced — separate: two sequences, one per parent (with their step-partner), no combined parent shot
  if (status.includes("separate")) {
    const sideA = buildCanonicalSide({
      subject, partner,
      momName: p1,
      dadName: fam.step_parent_1?.trim() || undefined,
      siblings: sibs,
      sideLabel: `${sideLabelBase} — ${p1 ?? "Parent 1"} side`,
    });
    const sideB = buildCanonicalSide({
      subject, partner,
      momName: p2,
      dadName: fam.step_parent_2?.trim() || undefined,
      siblings: sibs,
      sideLabel: `${sideLabelBase} — ${p2 ?? "Parent 2"} side`,
    });
    return [...sideA, ...sideB].map((s, i) => ({ ...s, order: i + 1 }));
  }

  // Single parent: one parent only
  if (status.includes("single")) {
    const only = p1 || p2;
    return buildCanonicalSide({
      subject, partner, momName: only, dadName: undefined,
      siblings: sibs, sideLabel: sideLabelBase,
    });
  }

  // Deceased: skip deceased parent's solo (omit their name as a parent, but keep honoring note if requested)
  if (status.includes("deceased")) {
    const dec1 = fam.parent_1?.deceased;
    const dec2 = fam.parent_2?.deceased;
    const honor =
      (dec1 && fam.parent_1?.honor_in_photo && fam.parent_1?.name) ? { name: fam.parent_1.name } :
      (dec2 && fam.parent_2?.honor_in_photo && fam.parent_2?.name) ? { name: fam.parent_2.name } :
      undefined;
    return buildCanonicalSide({
      subject, partner,
      momName: dec1 ? undefined : p1,
      dadName: dec2 ? undefined : p2,
      siblings: sibs, sideLabel: sideLabelBase, honorDeceased: honor,
    });
  }

  // married_together OR divorced_friendly → standard sequence
  return buildCanonicalSide({
    subject, partner, momName: p1, dadName: p2,
    siblings: sibs, sideLabel: sideLabelBase,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRole);

  try {
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    const isStudio = prof && ["owner", "studio_manager", "associate_photographer"].includes(prof.role as string);

    const body = await req.json();
    const client_id: string = body.client_id;
    let questionnaire_id: string | undefined = body.questionnaire_id;
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!isStudio) {
      const { data: cu } = await admin.from("client_users").select("client_id").eq("user_id", userData.user.id).eq("client_id", client_id).maybeSingle();
      if (!cu) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!questionnaire_id) {
      const { data: q } = await admin
        .from("questionnaires")
        .select("id, template:questionnaire_templates!inner(name)")
        .eq("client_id", client_id)
        .eq("template.name", "Wedding Details & Logistics")
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (q) questionnaire_id = q.id;
    }
    if (!questionnaire_id) {
      return new Response(JSON.stringify({ error: "logistics_questionnaire_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: q } = await admin.from("questionnaires").select("id, responses, client_id").eq("id", questionnaire_id).maybeSingle();
    if (!q) return new Response(JSON.stringify({ error: "questionnaire_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const r = (q.responses ?? {}) as Record<string, any>;
    const { data: client } = await admin.from("clients").select("couple_name_1, couple_name_2").eq("id", client_id).maybeSingle();
    const coupleNames = [client?.couple_name_1, client?.couple_name_2].filter(Boolean) as string[];

    const fam1: FamilyData = (r.partner_1_family ?? {}) as FamilyData;
    const fam2: FamilyData = (r.partner_2_family ?? {}) as FamilyData;
    const combinedChoice: string = (r.combined_family_photo ?? "").toString();
    const wp = (r.wedding_party ?? {}) as any;
    const extended = Array.isArray(r.extended_portraits) ? r.extended_portraits : [];

    const partner_1_sequence = buildForSide(coupleNames, fam1, 0);
    const partner_2_sequence = buildForSide(coupleNames, fam2, 1);

    const combined_sequence: SequenceStep[] = [];
    const lc = combinedChoice.toLowerCase();
    if (lc.startsWith("yes")) {
      const all1 = [fam1.parent_1?.name, fam1.parent_2?.name, fam1.step_parent_1, fam1.step_parent_2].filter(Boolean) as string[];
      const all2 = [fam2.parent_1?.name, fam2.parent_2?.name, fam2.step_parent_1, fam2.step_parent_2].filter(Boolean) as string[];
      const sibs1 = (fam1.siblings ?? []).filter((s) => s.name?.trim()).map((s) => s.name);
      const sibs2 = (fam2.siblings ?? []).filter((s) => s.name?.trim()).map((s) => s.name);
      const parentsOnly = [...coupleNames, ...all1, ...all2];
      combined_sequence.push({ order: 1, label: "Couple + All Parents", people: parentsOnly, minutes: minutesFor(parentsOnly) });
      if (!lc.includes("only parents")) {
        const everyone = [...parentsOnly, ...sibs1, ...sibs2];
        combined_sequence.push({ order: 2, label: "^ Add all siblings (one big family shot)", people: everyone, minutes: minutesFor(everyone) });
      }
    }

    const wedding_party_shots: SequenceStep[] = [];
    const wpShots: string[] = Array.isArray(wp.shots) ? wp.shots : [];
    const partySize = Number(wp.party_size ?? 0);
    if (partySize > 0) {
      let ord = 0;
      for (const shot of wpShots) {
        wedding_party_shots.push({ order: ++ord, label: shot, people: [], minutes: shot.includes("1:1") ? Math.max(5, partySize) : 3 });
      }
    }

    const extended_shots: SequenceStep[] = extended
      .filter((e: any) => e?.label?.trim())
      .map((e: any, i: number) => ({ order: i + 1, label: e.label, people: e.people ? [e.people] : [], minutes: 2 }));

    const sumMin = (arr: SequenceStep[]) => arr.reduce((acc, s) => acc + (s.minutes ?? 0), 0);
    const total_minutes =
      sumMin(partner_1_sequence) + sumMin(partner_2_sequence) + sumMin(combined_sequence) +
      sumMin(wedding_party_shots) + sumMin(extended_shots);

    const row = {
      client_id,
      questionnaire_response_id: questionnaire_id,
      generated_at: new Date().toISOString(),
      generated_from: "auto",
      partner_1_sequence,
      partner_2_sequence,
      combined_sequence,
      wedding_party_shots,
      extended_shots,
      total_minutes,
      notes: fam1.notes || fam2.notes ? [fam1.notes, fam2.notes].filter(Boolean).join("\n\n") : null,
    };

    const { data: up, error: upErr } = await admin
      .from("portrait_sequences")
      .upsert(row, { onConflict: "client_id" })
      .select("id")
      .single();
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ sequence_id: up.id, total_minutes, partner_1_sequence, partner_2_sequence, combined_sequence }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
