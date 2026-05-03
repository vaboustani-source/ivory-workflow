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

function minutesFor(people: Person[]): number {
  return people.length >= 7 ? 3 : 1;
}

function p(name: string | undefined, role: Role): Person | null {
  const n = (name ?? "").trim();
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

  const subjectP: Person = { name: subject, role: "subject" };
  const partnerP = p(partner, "partner");
  const momP = p(momName, momRole);
  const dadP = p(dadName, dadRole);
  const parentsBoth = clean([momP, dadP]);

  const sibsClean = siblings.filter((s) => s?.name?.trim());
  const sibPeople: Person[] = sibsClean.map((s) => ({ name: s.name.trim(), role: "sibling" }));
  const sibPartnerPeople: Person[] = sibsClean
    .filter((s) => s.has_partner && s.partner_name?.trim())
    .map((s) => ({ name: s.partner_name!.trim(), role: "sibling_partner" }));

  // 1: subject + Mom
  if (momP) push(`${subject} + ${momP.name}`, [subjectP, momP]);
  // 2: switch Mom for Dad
  if (dadP) {
    if (momP) push(`Switch ${momP.name} for ${dadP.name}`, [subjectP, dadP]);
    else push(`${subject} + ${dadP.name}`, [subjectP, dadP]);
  }
  // 3: Add back Mom (Parents + subject)
  if (parentsBoth.length >= 2 && momP) {
    push(`^ Add back ${momP.name} (Parents + ${subject})`, [subjectP, ...parentsBoth]);
  }
  // 4: Add Partner (Couple with Parents)
  if (parentsBoth.length > 0 && partnerP) {
    push(`^ Add ${partnerP.name} (Couple with Parents)`, [subjectP, partnerP, ...parentsBoth]);
  }

  // 5: Full Family — single step adding all sibs + their partners
  if (sibsClean.length > 0) {
    const sibLabelParts: string[] = sibsClean.map((s) => {
      if (s.has_partner && s.partner_name?.trim()) {
        return sibsClean.length === 1 ? `${s.name.trim()} + ${s.partner_name.trim()}` : s.name.trim();
      }
      return s.name.trim();
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
    push(`${subject} + ${s.name.trim()}`, [subjectP, { name: s.name.trim(), role: "sibling" }]);
  }

  // 10 (optional): each sibling + their partner (sib couple)
  for (const s of sibsClean) {
    if (s.has_partner && s.partner_name?.trim()) {
      push(
        `${s.name.trim()} + ${s.partner_name.trim()} (sib couple)`,
        [{ name: s.name.trim(), role: "sibling" }, { name: s.partner_name.trim(), role: "sibling_partner" }],
        { optional: "sibling_couples" }
      );
    }
  }

  // 11 (optional): subject + partner + sibling + sibling-partner (couples photo)
  if (partnerP) {
    for (const s of sibsClean) {
      if (s.has_partner && s.partner_name?.trim()) {
        push(
          `Couples: ${subject} & ${partnerP.name} + ${s.name.trim()} & ${s.partner_name.trim()}`,
          [
            subjectP, partnerP,
            { name: s.name.trim(), role: "sibling" },
            { name: s.partner_name.trim(), role: "sibling_partner" },
          ],
          { optional: "sibling_couples_with_us" }
        );
      }
    }
  }

  // 12: Parents alone
  if (parentsBoth.length >= 2 && momP && dadP) {
    push(`${momP.name} + ${dadP.name} (Parents alone)`, parentsBoth);
  } else if (parentsBoth.length === 1) {
    push(`${parentsBoth[0].name} + ${subject} (final beat)`, [parentsBoth[0], subjectP]);
  }

  // 13: setup buffer
  push(`(${sideLabel}) Setup buffer`, []);
  steps[steps.length - 1].minutes = SETUP_BUFFER_MIN;

  if (honorDeceased?.name) {
    push(`Moment of remembrance for ${honorDeceased.name}`, [], { note: "No shot — plan a quiet moment." });
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
  const includeSibCouples = !!fam.include_sibling_couples;
  const includeSibCouplesWithUs = !!fam.include_sibling_couples_with_us;

  if (status.includes("separate")) {
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

  if (status.includes("single")) {
    const only = p1 || p2;
    return buildCanonicalSide({
      subject, partner, momName: only, dadName: undefined,
      siblings: sibs, sideLabel: sideLabelBase,
      includeSibCouples, includeSibCouplesWithUs,
    });
  }

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
      includeSibCouples, includeSibCouplesWithUs,
    });
  }

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
      const parents1 = clean([
        p(fam1.parent_1?.name, "parent"), p(fam1.parent_2?.name, "parent"),
        p(fam1.step_parent_1, "step_parent"), p(fam1.step_parent_2, "step_parent"),
      ]);
      const parents2 = clean([
        p(fam2.parent_1?.name, "parent"), p(fam2.parent_2?.name, "parent"),
        p(fam2.step_parent_1, "step_parent"), p(fam2.step_parent_2, "step_parent"),
      ]);
      const sibs1: Person[] = (fam1.siblings ?? []).filter((s) => s.name?.trim()).map((s) => ({ name: s.name.trim(), role: "sibling" }));
      const sibs2: Person[] = (fam2.siblings ?? []).filter((s) => s.name?.trim()).map((s) => ({ name: s.name.trim(), role: "sibling" }));
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
