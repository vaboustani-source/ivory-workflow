// Edge Function: generate-portrait-sequence
// SBV canonical build-up-then-break-down family portrait sequence.
// Variants: married_together | divorced_friendly | divorced_separate | single_parent | deceased
// Each step = 1 min; +2 min if 7+ people; +4 min setup buffer per side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Role = "subject" | "partner" | "parent" | "step_parent" | "sibling" | "sibling_partner" | "other";
interface Person { name: string; role: Role; }

interface ParentInfo { name?: string; deceased?: boolean; honor_in_photo?: boolean; }
interface SiblingEntry { name: string; has_partner?: boolean; partner_name?: string; has_kids?: boolean; }
interface FamilyData {
  parents_status?: string;
  dynamics_notes?: string;
  parent_1?: ParentInfo;
  parent_2?: ParentInfo;
  step_parent_1?: string;
  step_parent_2?: string;
  siblings?: SiblingEntry[];
  grandparents?: string;
  notes?: string;
  include_sibling_couples?: boolean;
  include_sibling_couples_with_us?: boolean;
}

interface SequenceStep {
  order: number;
  label: string;
  people: Person[];
  minutes: number;
  note?: string;
  optional?: "sibling_couples" | "sibling_couples_with_us";
}

const SETUP_BUFFER_MIN = 4;

const firstName = (full?: string): string =>
  (full ?? "").trim().split(/\s+/)[0] ?? "";

function minutesFor(people: Person[]): number {
  return people.length >= 7 ? 3 : 1;
}

function p(name: string | undefined, role: Role): Person | null {
  const n = firstName(name);
  return n ? { name: n, role } : null;
}
function clean(arr: (Person | null | undefined)[]): Person[] {
  return arr.filter((x): x is Person => !!x && !!x.name);
}

function buildCanonicalSide(params: {
  subject: string;
  partner: string;
  momName?: string;
  dadName?: string;
  momRole?: Role; // "parent" or "step_parent"
  dadRole?: Role;
  siblings: SiblingEntry[];
  sideLabel: string;
  honorDeceased?: { name?: string };
  includeSibCouples?: boolean;
  includeSibCouplesWithUs?: boolean;
}): SequenceStep[] {
  const {
    subject, partner, momName, dadName,
    momRole = "parent", dadRole = "parent",
    siblings, sideLabel, honorDeceased,
    includeSibCouples, includeSibCouplesWithUs,
  } = params;

  const steps: SequenceStep[] = [];
  let order = 0;
  const push = (label: string, people: Person[], extra: Partial<SequenceStep> = {}) => {
    steps.push({ order: ++order, label, people, minutes: minutesFor(people), ...extra });
  };

  if (!subject) return steps;
  if (!momName && !dadName && siblings.length === 0) return steps;

  const subj = firstName(subject);
  const part = firstName(partner);
  const subjectP: Person = { name: subj, role: "subject" };
  const partnerP = p(partner, "partner");
  const momP = p(momName, momRole);
  const dadP = p(dadName, dadRole);
  const parentsBoth = clean([momP, dadP]);

  const sibsClean = siblings.filter((s) => s?.name?.trim());
  const sibPeople: Person[] = sibsClean.map((s) => ({ name: firstName(s.name), role: "sibling" }));
  const sibPartnerPeople: Person[] = sibsClean
    .filter((s) => s.has_partner && s.partner_name?.trim())
    .map((s) => ({ name: firstName(s.partner_name), role: "sibling_partner" }));

  // 1: subject + Mom
  if (momP) push(`${subj} + ${momP.name}`, [subjectP, momP]);
  // 2: switch Mom for Dad
  if (dadP) {
    if (momP) push(`Switch ${momP.name} for ${dadP.name}`, [subjectP, dadP]);
    else push(`${subj} + ${dadP.name}`, [subjectP, dadP]);
  }
  // 3: Add back Mom (Parents + subject)
  if (parentsBoth.length >= 2 && momP) {
    push(`^ Add back ${momP.name} (Parents + ${subj})`, [subjectP, ...parentsBoth]);
  }
  // 4: Add Partner (Couple with Parents)
  if (parentsBoth.length > 0 && partnerP) {
    push(`^ Add ${partnerP.name} (Couple with Parents)`, [subjectP, partnerP, ...parentsBoth]);
  }

  // 5: Full Family — single step adding all sibs + their partners
  if (sibsClean.length > 0) {
    const sibLabelParts: string[] = sibsClean.map((s) => {
      if (s.has_partner && s.partner_name?.trim()) {
        return sibsClean.length === 1 ? `${firstName(s.name)} + ${firstName(s.partner_name)}` : firstName(s.name);
      }
      return firstName(s.name);
    });
    const fullFamilyLabel =
      sibsClean.length === 1
        ? `^ Add ${sibLabelParts[0]}`
        : `^ Add ${sibLabelParts.join(", ")} + partners (Full Family)`;
    const fullFamilyPeople = clean([
      subjectP, partnerP, ...parentsBoth, ...sibPeople, ...sibPartnerPeople,
    ]);
    const anyKids = sibsClean.some((s) => s.has_kids);
    push(fullFamilyLabel, fullFamilyPeople, anyKids ? { note: "Include kids in family group?" } : {});
  }

  // 6: Take out Partner + sibling partners (OG Family)
  if (sibsClean.length > 0 && (partnerP || sibPartnerPeople.length > 0)) {
    push(
      `> Take out ${partnerP?.name ?? "partner"}${sibPartnerPeople.length ? " + sibling partners" : ""} (OG Family)`,
      clean([subjectP, ...parentsBoth, ...sibPeople])
    );
  }
  // 7: Take out Parents (OG Siblings)
  if (sibsClean.length > 0 && parentsBoth.length > 0) {
    push(`> Take out Parents (OG Siblings)`, [subjectP, ...sibPeople]);
  }
  // 8: Add back Partner + sibling partners (Sibs & Spouses) — NO parents
  if (sibsClean.length > 0 && (partnerP || sibPartnerPeople.length > 0)) {
    push(
      `^ Add back ${partnerP?.name ?? "partner"}${sibPartnerPeople.length ? " + sibling partners" : ""} (Sibs & Spouses)`,
      clean([subjectP, partnerP, ...sibPeople, ...sibPartnerPeople])
    );
  }

  // 9: Subject + each sibling (one shot per sibling)
  for (const s of sibsClean) {
    const sn = firstName(s.name);
    push(`${subj} + ${sn}`, [subjectP, { name: sn, role: "sibling" }]);
  }

  // 10 (optional): each sibling + their partner (sib couple)
  for (const s of sibsClean) {
    if (s.has_partner && s.partner_name?.trim()) {
      const sn = firstName(s.name);
      const pn = firstName(s.partner_name);
      push(
        `${sn} + ${pn} (sib couple)`,
        [{ name: sn, role: "sibling" }, { name: pn, role: "sibling_partner" }],
        { optional: "sibling_couples" }
      );
    }
  }

  // 11 (optional): subject + partner + sibling + sibling-partner (couples photo)
  if (partnerP) {
    for (const s of sibsClean) {
      if (s.has_partner && s.partner_name?.trim()) {
        const sn = firstName(s.name);
        const pn = firstName(s.partner_name);
        push(
          `Couples: ${subj} & ${partnerP.name} + ${sn} & ${pn}`,
          [
            subjectP, partnerP,
            { name: sn, role: "sibling" },
            { name: pn, role: "sibling_partner" },
          ],
          { optional: "sibling_couples_with_us" }
        );
      }
    }
  }

  if (parentsBoth.length >= 2 && momP && dadP) {
    push(`${momP.name} + ${dadP.name} (Parents alone)`, parentsBoth);
  } else if (parentsBoth.length === 1) {
    push(`${parentsBoth[0].name} + ${subj} (final beat)`, [parentsBoth[0], subjectP]);
  }

  // 13: setup buffer
  push(`(${sideLabel}) Setup buffer`, []);
  steps[steps.length - 1].minutes = SETUP_BUFFER_MIN;

  if (honorDeceased?.name) {
    push(`Moment of remembrance for ${firstName(honorDeceased.name)}`, [], { note: "No shot — plan a quiet moment." });
    steps[steps.length - 1].minutes = 0;
  }

  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

function buildDivorcedFriendlySequence(params: {
  subject: string;
  partner: string;
  parent1Name?: string;
  parent2Name?: string;
  stepParent1Name?: string;
  stepParent2Name?: string;
  siblings: SiblingEntry[];
  sideLabel: string;
  includeSibCouples?: boolean;
  includeSibCouplesWithUs?: boolean;
}): SequenceStep[] {
  const {
    subject, partner, parent1Name, parent2Name,
    stepParent1Name, stepParent2Name, siblings, sideLabel,
    includeSibCouples, includeSibCouplesWithUs,
  } = params;

  const steps: SequenceStep[] = [];
  const push = (label: string, people: Person[], extra: Partial<SequenceStep> = {}) => {
    steps.push({ order: steps.length + 1, label, people, minutes: minutesFor(people), ...extra });
  };
  const pushBuffer = (label: string) => {
    steps.push({ order: steps.length + 1, label, people: [], minutes: SETUP_BUFFER_MIN });
  };

  if (!subject) return steps;
  const subj = firstName(subject);
  const subjectP: Person = { name: subj, role: "subject" };
  const partnerP = p(partner, "partner");

  const sibsClean = siblings.filter((s) => s?.name?.trim());
  const sibPeople: Person[] = sibsClean.map((s) => ({ name: firstName(s.name), role: "sibling" }));
  const sibPartnerPeople: Person[] = sibsClean
    .filter((s) => s.has_partner && s.partner_name?.trim())
    .map((s) => ({ name: firstName(s.partner_name), role: "sibling_partner" }));

  const buildMini = (
    parentName: string | undefined,
    stepName: string | undefined,
    sideTag: string,
  ) => {
    const parentP = p(parentName, "parent");
    const stepP = p(stepName, "step_parent");
    if (!parentP) return;

    // Step 1: Subject + Parent
    push(`${subj} + ${parentP.name}`, [subjectP, parentP]);

    // Step 2: Add Step-Parent
    if (stepP) {
      push(
        `^ Add ${stepP.name} (${subj} + ${parentP.name} + ${stepP.name})`,
        [subjectP, parentP, stepP],
      );
    }

    // Step 3: Add Subject's spouse
    if (partnerP) {
      const withStep = stepP ? ` + ${stepP.name}` : "";
      push(
        `^ Add ${partnerP.name} (Couple with ${parentP.name}${withStep})`,
        clean([subjectP, partnerP, parentP, stepP]),
      );
    }

    // Step 4: Add siblings
    if (sibsClean.length > 0) {
      const sibLabelParts = sibsClean.map((s) =>
        s.has_partner && s.partner_name?.trim() && sibsClean.length === 1
          ? `${firstName(s.name)} + ${firstName(s.partner_name)}`
          : firstName(s.name),
      );
      const anyPartners = sibPartnerPeople.length > 0 && sibsClean.length > 1;
      const fullLabel =
        sibsClean.length === 1
          ? `^ Add ${sibLabelParts[0]} (Full Family — ${sideTag})`
          : `^ Add ${sibLabelParts.join(", ")}${anyPartners ? " (and partners)" : ""} (Full Family — ${sideTag})`;
      push(
        fullLabel,
        clean([subjectP, partnerP, parentP, stepP, ...sibPeople, ...sibPartnerPeople]),
      );
    }

    // Step 5: Take out spouse + step-parent + sibling partners → OG family
    if (sibsClean.length > 0 || partnerP || stepP) {
      const removed: string[] = [];
      if (partnerP) removed.push(partnerP.name);
      if (stepP) removed.push(stepP.name);
      if (sibPartnerPeople.length > 0) removed.push("sibling partners");
      if (removed.length > 0) {
        push(
          `> Take out ${removed.join(" + ")} (OG Family — ${sideTag})`,
          clean([subjectP, parentP, ...sibPeople]),
        );
      }
    }
  };

  // Mini 1
  buildMini(parent1Name, stepParent1Name, `${firstName(parent1Name) || "Parent 1"} side`);
  pushBuffer(`(${sideLabel}) Setup buffer`);
  // Mini 2
  buildMini(parent2Name, stepParent2Name, `${firstName(parent2Name) || "Parent 2"} side`);
  pushBuffer(`(${sideLabel}) Setup buffer`);

  // Mini 3: Combined (biological parents only)
  const par1P = p(parent1Name, "parent");
  const par2P = p(parent2Name, "parent");
  if (par1P && par2P) {
    push(`${subj} + ${par1P.name} + ${par2P.name}`, [subjectP, par1P, par2P]);
    if (partnerP) {
      push(
        `^ Add ${partnerP.name} (Couple with both parents)`,
        [subjectP, partnerP, par1P, par2P],
      );
    }
    if (sibsClean.length > 0) {
      const sibLabelParts = sibsClean.map((s) =>
        s.has_partner && s.partner_name?.trim() && sibsClean.length === 1
          ? `${firstName(s.name)} + ${firstName(s.partner_name)}`
          : firstName(s.name),
      );
      const anyPartners = sibPartnerPeople.length > 0 && sibsClean.length > 1;
      push(
        sibsClean.length === 1
          ? `^ Add ${sibLabelParts[0]} (Full Family combined)`
          : `^ Add ${sibLabelParts.join(", ")}${anyPartners ? " (and partners)" : ""} (Full Family combined)`,
        clean([subjectP, partnerP, par1P, par2P, ...sibPeople, ...sibPartnerPeople]),
      );
    }
  }

  // Individual sibling beats
  for (const s of sibsClean) {
    const sn = firstName(s.name);
    push(`${subj} + ${sn}`, [subjectP, { name: sn, role: "sibling" }]);
  }
  if (includeSibCouples) {
    for (const s of sibsClean) {
      if (s.has_partner && s.partner_name?.trim()) {
        const sn = firstName(s.name);
        const pn = firstName(s.partner_name);
        push(
          `${sn} + ${pn} (sib couple)`,
          [{ name: sn, role: "sibling" }, { name: pn, role: "sibling_partner" }],
          { optional: "sibling_couples" },
        );
      }
    }
  }
  if (includeSibCouplesWithUs && partnerP) {
    for (const s of sibsClean) {
      if (s.has_partner && s.partner_name?.trim()) {
        const sn = firstName(s.name);
        const pn = firstName(s.partner_name);
        push(
          `Couples: ${subj} & ${partnerP.name} + ${sn} & ${pn}`,
          [subjectP, partnerP, { name: sn, role: "sibling" }, { name: pn, role: "sibling_partner" }],
          { optional: "sibling_couples_with_us" },
        );
      }
    }
  }

  // Final beat: parents + step-parents alone
  const stepP1 = p(stepParent1Name, "step_parent");
  const stepP2 = p(stepParent2Name, "step_parent");
  const parentsFinal = clean([par1P, par2P, stepP1, stepP2]);
  if (parentsFinal.length >= 2) {
    const names = parentsFinal.map((x) => x.name).join(" + ");
    push(`${names} (Parents${stepP1 || stepP2 ? " + step-parents" : ""} alone)`, parentsFinal);
  }

  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

function buildForSide(coupleNames: string[], fam: FamilyData, sideIndex: 0 | 1): SequenceStep[] {
  const subject = coupleNames[sideIndex] ?? `Partner ${sideIndex + 1}`;
  const partner = coupleNames[1 - sideIndex] ?? "";
  const sibs = fam.siblings ?? [];
  const p1 = fam.parent_1?.name?.trim();
  const p2 = fam.parent_2?.name?.trim();
  const sideLabelBase = `Partner ${sideIndex + 1}`;
  const includeSibCouples = !!fam.include_sibling_couples;
  const includeSibCouplesWithUs = !!fam.include_sibling_couples_with_us;

  const statusLower = (fam.parents_status ?? "").toLowerCase();
  let variant: "married" | "divorced_separate" | "divorced_friendly" | "single" | "deceased" | "complicated" = "married";
  if (statusLower.includes("divorced") && statusLower.includes("separate")) {
    variant = "divorced_separate";
  } else if (statusLower.includes("divorced")) {
    variant = "divorced_friendly";
  } else if (statusLower.includes("single")) {
    variant = "single";
  } else if (statusLower.includes("deceased")) {
    variant = "deceased";
  } else if (statusLower.includes("complicated")) {
    variant = "complicated";
  }

  if (variant === "complicated") {
    return [{
      order: 1,
      label: "Family dynamics complex — Dexter will build this manually based on couple's notes",
      people: [],
      minutes: 0,
      note: "See Family Notes above.",
    }];
  }

  if (variant === "divorced_separate") {
    const sideA = buildCanonicalSide({
      subject, partner, momName: p1, momRole: "parent",
      dadName: fam.step_parent_1?.trim() || undefined, dadRole: "step_parent",
      siblings: sibs, sideLabel: `${sideLabelBase} — ${p1 ?? "Parent 1"} side`,
      includeSibCouples, includeSibCouplesWithUs,
    });
    const sideB = buildCanonicalSide({
      subject, partner, momName: p2, momRole: "parent",
      dadName: fam.step_parent_2?.trim() || undefined, dadRole: "step_parent",
      siblings: sibs, sideLabel: `${sideLabelBase} — ${p2 ?? "Parent 2"} side`,
      includeSibCouples, includeSibCouplesWithUs,
    });
    return [...sideA, ...sideB].map((s, i) => ({ ...s, order: i + 1 }));
  }

  if (variant === "single") {
    const only = p1 || p2;
    return buildCanonicalSide({
      subject, partner, momName: only, dadName: undefined,
      siblings: sibs, sideLabel: sideLabelBase,
      includeSibCouples, includeSibCouplesWithUs,
    });
  }

  if (variant === "deceased") {
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
      includeSibCouples, includeSibCouplesWithUs,
    });
  }

  // married OR divorced_friendly: standard sequence with mom + dad.
  // Step-parents are captured in the questionnaire but not auto-inserted —
  // studio inline edit handles inclusion.
  return buildCanonicalSide({
    subject, partner, momName: p1, dadName: p2,
    siblings: sibs, sideLabel: sideLabelBase,
    includeSibCouples, includeSibCouplesWithUs,
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
    const coupleNames = [firstName(client?.couple_name_1), firstName(client?.couple_name_2)].filter(Boolean) as string[];

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
      const parents1 = clean([
        p(fam1.parent_1?.name, "parent"), p(fam1.parent_2?.name, "parent"),
        p(fam1.step_parent_1, "step_parent"), p(fam1.step_parent_2, "step_parent"),
      ]);
      const parents2 = clean([
        p(fam2.parent_1?.name, "parent"), p(fam2.parent_2?.name, "parent"),
        p(fam2.step_parent_1, "step_parent"), p(fam2.step_parent_2, "step_parent"),
      ]);
      const sibs1: Person[] = (fam1.siblings ?? []).filter((s) => s.name?.trim()).map((s) => ({ name: firstName(s.name), role: "sibling" }));
      const sibs2: Person[] = (fam2.siblings ?? []).filter((s) => s.name?.trim()).map((s) => ({ name: firstName(s.name), role: "sibling" }));
      const couplePeople: Person[] = coupleNames.map((n, i) => ({ name: n, role: i === 0 ? "subject" : "partner" }));
      const parentsOnly = [...couplePeople, ...parents1, ...parents2];
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
      .map((e: any, i: number) => ({
        order: i + 1, label: e.label,
        people: e.people ? [{ name: String(e.people), role: "other" as Role }] : [],
        minutes: 2,
      }));

    // total_minutes excludes optional steps unless user has toggled them on in questionnaire.
    const fam1OptOn = !!(fam1.include_sibling_couples || fam1.include_sibling_couples_with_us);
    const fam2OptOn = !!(fam2.include_sibling_couples || fam2.include_sibling_couples_with_us);
    const sumMin = (arr: SequenceStep[], includeOptional: boolean) =>
      arr.reduce((acc, s) => acc + (s.optional && !includeOptional ? 0 : (s.minutes ?? 0)), 0);
    const total_minutes =
      sumMin(partner_1_sequence, fam1OptOn) + sumMin(partner_2_sequence, fam2OptOn) +
      sumMin(combined_sequence, true) + sumMin(wedding_party_shots, true) + sumMin(extended_shots, true);

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
      notes: (() => {
        const parts: string[] = [];
        if (fam1.dynamics_notes?.trim()) parts.push(`Partner 1 family dynamics:\n${fam1.dynamics_notes.trim()}`);
        if (fam2.dynamics_notes?.trim()) parts.push(`Partner 2 family dynamics:\n${fam2.dynamics_notes.trim()}`);
        if (fam1.notes?.trim()) parts.push(`Partner 1 side notes:\n${fam1.notes.trim()}`);
        if (fam2.notes?.trim()) parts.push(`Partner 2 side notes:\n${fam2.notes.trim()}`);
        return parts.length ? parts.join("\n\n") : null;
      })(),
      // Reset couple approval whenever sequence is regenerated
      approved_at: null,
      approved_by: null,
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
