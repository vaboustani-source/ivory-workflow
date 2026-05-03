// Edge Function: generate-portrait-sequence
// Builds a stacked family portrait shot order for a couple from their family questionnaire data.
// Input: { client_id: string, questionnaire_id?: string }
// Output: { sequence_id, total_minutes, partner_1_sequence, partner_2_sequence, combined_sequence }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParentInfo { name: string; }
interface SiblingEntry { name: string; has_partner: boolean; partner_name?: string; }
interface FamilyData {
  parents_status?: string;
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
}

const MIN_PER_SHOT = 2;

function joinPeople(arr: string[]): string {
  const filtered = arr.filter(Boolean);
  if (filtered.length <= 2) return filtered.join(" + ");
  return filtered.slice(0, -1).join(", ") + " + " + filtered[filtered.length - 1];
}

// Build the stacked sequence for ONE side of the family.
// Strategy: start tightest (couple + immediate parents), add siblings, add sibling partners,
// then peel back layers (parents alone, individual parent w/ couple), then grandparents.
// For divorced — separate, this generator is called twice (once per parent).
function buildSideSequence(
  coupleNames: string[],
  fam: FamilyData,
  opts: { onlyParent?: "p1" | "p2"; sideLabel: string } = { sideLabel: "" }
): SequenceStep[] {
  const steps: SequenceStep[] = [];
  const p1 = fam.parent_1?.name?.trim();
  const p2 = fam.parent_2?.name?.trim();
  const sp1 = fam.step_parent_1?.trim();
  const sp2 = fam.step_parent_2?.trim();
  const sibs = (fam.siblings ?? []).filter((s) => s.name?.trim());
  const grandparents = fam.grandparents?.trim();

  let parents: string[] = [];
  if (opts.onlyParent === "p1") parents = [p1, sp1].filter(Boolean) as string[];
  else if (opts.onlyParent === "p2") parents = [p2, sp2].filter(Boolean) as string[];
  else parents = [p1, p2].filter(Boolean) as string[];

  if (parents.length === 0 && sibs.length === 0 && !grandparents) return steps;

  let order = 0;
  const push = (label: string, people: string[], minutes = MIN_PER_SHOT) => {
    steps.push({ order: ++order, label, people, minutes });
  };

  const sibAll = sibs.map((s) => s.name);
  const sibPartners = sibs.filter((s) => s.has_partner && s.partner_name?.trim()).map((s) => s.partner_name!.trim());

  // 1. Couple + everyone (parents + sibs + sib partners)
  if (parents.length || sibAll.length) {
    push(
      `Couple + ${opts.sideLabel} immediate family`,
      [...coupleNames, ...parents, ...sibAll, ...sibPartners]
    );
  }
  // 2. Without sib partners
  if (sibPartners.length > 0 && (parents.length || sibAll.length)) {
    push(
      `Couple + ${opts.sideLabel} parents + siblings`,
      [...coupleNames, ...parents, ...sibAll]
    );
  }
  // 3. Couple + parents only
  if (parents.length > 0 && sibAll.length > 0) {
    push(`Couple + ${opts.sideLabel} parents`, [...coupleNames, ...parents]);
  }
  // 4. Each individual parent with couple
  if (parents.length >= 2) {
    for (const p of parents) push(`Couple + ${p}`, [...coupleNames, p]);
  }
  // 5. Siblings with couple (no parents)
  if (sibAll.length > 0 && parents.length > 0) {
    push(`Couple + ${opts.sideLabel} siblings`, [...coupleNames, ...sibAll, ...sibPartners]);
  }
  // 6. Grandparents
  if (grandparents) {
    push(`Couple + ${opts.sideLabel} grandparents`, [...coupleNames, grandparents]);
  }
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
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
    const combinedChoice: string = r.combined_family_photo ?? "";
    const wp = (r.wedding_party ?? {}) as any;
    const extended = Array.isArray(r.extended_portraits) ? r.extended_portraits : [];

    const buildForSide = (fam: FamilyData, label: string): SequenceStep[] => {
      if (fam.parents_status === "Divorced — separate photos") {
        const a = buildSideSequence(coupleNames, fam, { onlyParent: "p1", sideLabel: `${label} (${fam.parent_1?.name ?? "Parent 1"})` });
        const b = buildSideSequence(coupleNames, fam, { onlyParent: "p2", sideLabel: `${label} (${fam.parent_2?.name ?? "Parent 2"})` });
        return [...a, ...b].map((s, i) => ({ ...s, order: i + 1 }));
      }
      return buildSideSequence(coupleNames, fam, { sideLabel: label });
    };

    const partner_1_sequence = buildForSide(fam1, "Partner 1");
    const partner_2_sequence = buildForSide(fam2, "Partner 2");

    const combined_sequence: SequenceStep[] = [];
    if (combinedChoice.startsWith("Yes")) {
      const all1 = [fam1.parent_1?.name, fam1.parent_2?.name, fam1.step_parent_1, fam1.step_parent_2].filter(Boolean) as string[];
      const all2 = [fam2.parent_1?.name, fam2.parent_2?.name, fam2.step_parent_1, fam2.step_parent_2].filter(Boolean) as string[];
      const sibs1 = (fam1.siblings ?? []).filter((s) => s.name?.trim()).map((s) => s.name);
      const sibs2 = (fam2.siblings ?? []).filter((s) => s.name?.trim()).map((s) => s.name);
      if (combinedChoice.includes("only parents")) {
        combined_sequence.push({ order: 1, label: "Both families — parents only", people: [...coupleNames, ...all1, ...all2], minutes: 3 });
      } else {
        combined_sequence.push({ order: 1, label: "Both families — everyone", people: [...coupleNames, ...all1, ...all2, ...sibs1, ...sibs2], minutes: 4 });
        combined_sequence.push({ order: 2, label: "Both families — parents only", people: [...coupleNames, ...all1, ...all2], minutes: 3 });
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
