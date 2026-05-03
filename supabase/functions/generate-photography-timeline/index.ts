// Edge Function: generate-photography-timeline
// Builds a wedding day photography timeline for a client from their logistics questionnaire.
// Input: { client_id: string, questionnaire_id?: string }
// Output: { timeline_id, blocks }
//
// Auth: requires a studio user (owner / studio_manager / associate_photographer).
// External APIs called (best-effort, fail-soft): geocode-address, compute-sunset-time, compute-travel-time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ------- helpers ---------------------------------------------------------

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function parseCeremonyLength(s: string | undefined): number {
  if (!s) return 30;
  // Handle ranges like "15-20 min" → midpoint 17
  const range = /(\d+)\s*[-–]\s*(\d+)/.exec(s);
  if (range) return Math.round((parseInt(range[1], 10) + parseInt(range[2], 10)) / 2);
  const m = /(\d+)/.exec(s);
  return m ? parseInt(m[1], 10) : 30;
}
function bool(v: unknown, def = false): boolean {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "yes" || t.startsWith("yes");
  }
  if (typeof v === "boolean") return v;
  return def;
}
function firstAddressLine(s: string | undefined): string {
  if (!s) return "";
  // Accept first non-empty line as the primary address
  const line = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
  return line ?? "";
}
function computeGroupPortraitMinutes(text: string | undefined, hasWeddingParty: boolean): number {
  if (!text || !text.trim()) return hasWeddingParty ? 60 : 30;
  const items = text.split(/[\n,]| and /i).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return 60;
  let total = 0;
  for (const item of items) {
    const big = /\b(group|everyone|full|extended|all|large|entire|whole)\b/i.test(item);
    total += big ? 2 : 1;
  }
  if (total > 90) total = 90;
  if (!hasWeddingParty && items.length <= 4 && total < 30) total = 30;
  return Math.max(15, total);
}

interface Block {
  start: string;
  end: string;
  label: string;
  type: "shoot" | "ceremony" | "travel" | "reception" | "golden_hour" | "buffer";
  notes?: string;
  location?: string;
}

function pushBlock(blocks: Block[], start: number, end: number, label: string, type: Block["type"], extras: Partial<Block> = {}) {
  blocks.push({ start: toHHMM(start), end: toHHMM(end), label, type, ...extras });
}

// ------- main ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Auth check using user JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
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

    // Couple is allowed to trigger only for their own client (via client_users)
    if (!isStudio) {
      const { data: cu } = await admin.from("client_users").select("client_id").eq("user_id", userData.user.id).eq("client_id", client_id).maybeSingle();
      if (!cu) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Find the Wedding Details & Logistics questionnaire if not provided
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

    const { data: q } = await admin
      .from("questionnaires")
      .select("id, responses, client_id")
      .eq("id", questionnaire_id)
      .maybeSingle();
    if (!q) {
      return new Response(JSON.stringify({ error: "questionnaire_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const r = (q.responses ?? {}) as Record<string, any>;

    const ceremonyStart = String(r.ceremony_start_time ?? "16:00");
    const ceremonyLength = parseCeremonyLength(r.ceremony_length as string | undefined);
    const hasFirstLook = bool(r.has_first_look);
    const ketubahDesc = (r.ketubah_or_ritual as string | undefined)?.trim();
    const hasJewishKetubah = !!(ketubahDesc && ketubahDesc.length > 0 && !/^no(ne)?$/i.test(ketubahDesc));

    // Wedding party: derive from wedding_party.party_size > 0
    const wp = (r.wedding_party ?? {}) as any;
    const partySize = Number(wp?.party_size ?? 0);
    const hasWeddingParty = partySize > 0;

    // Group portrait minutes derived from family + extended structured data
    const fam1 = (r.partner_1_family ?? {}) as any;
    const fam2 = (r.partner_2_family ?? {}) as any;
    const sib1 = Array.isArray(fam1.siblings) ? fam1.siblings.length : 0;
    const sib2 = Array.isArray(fam2.siblings) ? fam2.siblings.length : 0;
    const extendedShots = Array.isArray(r.extended_portraits) ? r.extended_portraits.length : 0;
    let groupPortraitMinutes = 0;
    // ~2 min per immediate family unit on each side, plus combined, plus wedding party formals, plus extended
    groupPortraitMinutes += (1 + Math.max(0, sib1)) * 2; // P1 side
    groupPortraitMinutes += (1 + Math.max(0, sib2)) * 2; // P2 side
    if (typeof r.combined_family_photo === "string" && r.combined_family_photo.startsWith("Yes")) groupPortraitMinutes += 5;
    if (hasWeddingParty) groupPortraitMinutes += Math.min(20, 8 + Math.ceil(partySize / 2));
    groupPortraitMinutes += extendedShots * 2;
    if (groupPortraitMinutes < 30) groupPortraitMinutes = 30;
    if (groupPortraitMinutes > 90) groupPortraitMinutes = 90;

    const grAddress = firstAddressLine(r.getting_ready_address as string | undefined);
    const cerAddress = String(r.ceremony_address ?? "").trim() || grAddress;
    const sameRec = typeof r.same_address_reception === "string" && r.same_address_reception.startsWith("Yes");
    const recAddress = sameRec ? cerAddress : (String(r.reception_address ?? "").trim() || cerAddress);

    const receptionEvents = Array.isArray(r.reception_schedule) ? (r.reception_schedule as Array<{ time: string; label: string }>) : [];
    const dinnerEnd = (r.dinner_end_time as string | undefined) ?? null;
    const special = String(r.special_reception_moments ?? "");
    const hasExtendedDancing = /(extended|extra hour|late night|after.?party)/i.test(special);

    // External calls — best-effort
    const fnUrl = (name: string) => `${supabaseUrl}/functions/v1/${name}`;
    const fnHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}`, apikey: serviceRole };

    let travelGrToCer = 0;
    if (grAddress && cerAddress && grAddress !== cerAddress) {
      try {
        const tr = await fetch(fnUrl("compute-travel-time"), { method: "POST", headers: fnHeaders, body: JSON.stringify({ from_address: grAddress, to_address: cerAddress }) });
        const tj = await tr.json();
        if (typeof tj.duration_minutes === "number") travelGrToCer = tj.duration_minutes;
        else console.error("[generate-photography-timeline] travel gr→cer returned:", tj);
      } catch (e) {
        console.error("[generate-photography-timeline] travel gr→cer failed:", e);
      }
    }
    let travelCerToRec = 0;
    if (cerAddress && recAddress && cerAddress !== recAddress) {
      try {
        const tr = await fetch(fnUrl("compute-travel-time"), { method: "POST", headers: fnHeaders, body: JSON.stringify({ from_address: cerAddress, to_address: recAddress }) });
        const tj = await tr.json();
        if (typeof tj.duration_minutes === "number") travelCerToRec = tj.duration_minutes;
        else console.error("[generate-photography-timeline] travel cer→rec returned:", tj);
      } catch (e) {
        console.error("[generate-photography-timeline] travel cer→rec failed:", e);
      }
    }

    // Sunset — needs lat/lng + wedding date
    const { data: clientRow } = await admin.from("clients").select("wedding_date").eq("id", client_id).maybeSingle();
    let sunsetTime: string | null = null;
    let goldenHourStart: string | null = null;
    if (clientRow?.wedding_date && cerAddress) {
      try {
        const gr = await fetch(fnUrl("geocode-address"), { method: "POST", headers: fnHeaders, body: JSON.stringify({ address: cerAddress }) });
        const gj = await gr.json();
        if (typeof gj.lat === "number") {
          const sr = await fetch(fnUrl("compute-sunset-time"), { method: "POST", headers: fnHeaders, body: JSON.stringify({ lat: gj.lat, lng: gj.lng, date_iso: clientRow.wedding_date }) });
          const sj = await sr.json();
          if (sj.sunset_local) {
            sunsetTime = sj.sunset_local;
            goldenHourStart = sj.golden_hour_start;
          } else {
            console.error("[generate-photography-timeline] sunset returned:", sj);
          }
        } else {
          console.error("[generate-photography-timeline] geocode returned:", gj);
        }
      } catch (e) {
        console.error("[generate-photography-timeline] sunset/geocode failed:", e);
      }
    }

    // ----- Build the timeline ------------------------------------------
    const blocks: Block[] = [];
    const ceremonyStartM = toMinutes(ceremonyStart);
    const preCeremonyHours = hasFirstLook ? 4 : 3;
    let coverageStartM = ceremonyStartM - preCeremonyHours * 60 - travelGrToCer;

    let cur = coverageStartM;

    // 1. Getting Ready
    pushBlock(blocks, cur, cur + 60, "Getting Ready", "shoot", { location: grAddress || undefined });
    cur += 60;

    if (hasFirstLook) {
      // 2. First Look + Couple Portraits
      pushBlock(blocks, cur, cur + 60, "First Look + Couple Portraits", "shoot");
      cur += 60;
      // 3. Group Portraits
      pushBlock(blocks, cur, cur + groupPortraitMinutes, "Group Portraits", "shoot", { notes: `${groupPortraitMinutes} min based on shot list` });
      cur += groupPortraitMinutes;
      // 4. Ceremony Details + Couple Prep
      const detailsLen = hasJewishKetubah ? 75 : 60;
      pushBlock(blocks, cur, cur + detailsLen, hasJewishKetubah ? "Ketubah Signing + Ceremony Details" : "Ceremony Details + Couple Prep", "shoot");
      cur += detailsLen;
    } else {
      // 2. Single Portraits & Single-side Family + WP
      pushBlock(blocks, cur, cur + 60, "Single Portraits & Single-side Family" + (hasWeddingParty ? " + Wedding Party" : ""), "shoot");
      cur += 60;
      // 3. Ceremony Details + Couple Prep
      const detailsLen = hasJewishKetubah ? 75 : 60;
      pushBlock(blocks, cur, cur + detailsLen, hasJewishKetubah ? "Ketubah Signing + Ceremony Details" : "Ceremony Details + Couple Prep", "shoot");
      cur += detailsLen;
    }

    // Travel to ceremony if needed (slot just before ceremony)
    if (travelGrToCer > 0) {
      pushBlock(blocks, ceremonyStartM - travelGrToCer, ceremonyStartM, "Travel to Ceremony", "travel", { notes: `${travelGrToCer} min drive` });
    }

    // Ceremony
    pushBlock(blocks, ceremonyStartM, ceremonyStartM + ceremonyLength, "Ceremony", "ceremony", { location: cerAddress || undefined });
    let postCeremony = ceremonyStartM + ceremonyLength;

    if (!hasFirstLook) {
      // Combined shots + Couple Portraits
      pushBlock(blocks, postCeremony, postCeremony + 35, "Combined Family Shots + Couple Portraits", "shoot", {
        notes: "Recommend extending cocktail hour OR couple may not attend full cocktail hour",
      });
      postCeremony += 35;
    }

    // Travel ceremony → reception
    if (travelCerToRec > 0) {
      pushBlock(blocks, postCeremony, postCeremony + travelCerToRec, "Travel to Reception", "travel", { notes: `${travelCerToRec} min drive` });
      postCeremony += travelCerToRec;
    }

    // Cocktail hour
    pushBlock(blocks, postCeremony, postCeremony + 60, "Cocktail Hour", "reception", { location: recAddress || undefined });
    let receptionStart = postCeremony + 60;

    // Reception events from couple's input — render in order
    const sortedEvents = [...receptionEvents].filter((e) => e?.time).sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    for (const ev of sortedEvents) {
      const startM = toMinutes(ev.time);
      pushBlock(blocks, startM, startM + 15, ev.label || "Reception event", "reception");
      receptionStart = Math.max(receptionStart, startM + 15);
    }

    // Golden hour 15-min slot
    if (goldenHourStart) {
      const ghStart = toMinutes(goldenHourStart);
      const conflict = sortedEvents.find((e) => Math.abs(toMinutes(e.time) - ghStart) < 15);
      const note = conflict
        ? `Slot 15 min near sunset (${goldenHourStart}). Conflicts with "${conflict.label}" — slot before/after.`
        : `Best light at ${goldenHourStart}. Steal the couple for 15 min.`;
      pushBlock(blocks, ghStart, ghStart + 15, "Golden Hour Portraits", "golden_hour", { notes: note });
    }

    // Coverage end
    let coverageEndM: number;
    if (dinnerEnd) {
      coverageEndM = toMinutes(dinnerEnd) + (hasExtendedDancing ? 120 : 60);
    } else if (sortedEvents.length > 0) {
      coverageEndM = toMinutes(sortedEvents[sortedEvents.length - 1].time) + 90;
    } else {
      coverageEndM = receptionStart + 120;
    }
    pushBlock(blocks, coverageEndM, coverageEndM, "Coverage End", "buffer", { notes: hasExtendedDancing ? "Extended dancing coverage" : "Standard 60 min after dinner" });

    // Sort blocks by start time for clean display
    blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    // ----- Coverage hours analysis ---------------------------------------
    const { data: clientCov } = await admin
      .from("clients")
      .select("coverage_hours, couple_name_1, couple_name_2")
      .eq("id", client_id)
      .maybeSingle();
    const bookedCoverageHours: number | null =
      clientCov?.coverage_hours != null ? Number(clientCov.coverage_hours) : null;

    const covStartM = toMinutes(blocks[0].start);
    const covEndM = toMinutes(blocks[blocks.length - 1].end || blocks[blocks.length - 1].start);
    const generatedCoverageHours = Math.round(((covEndM - covStartM) / 60) * 10) / 10;

    let coverageStatus: "fits" | "exceeds" | "no_booked_hours" = "no_booked_hours";
    let coverageOverageHours: number | null = null;
    if (bookedCoverageHours != null) {
      const diff = generatedCoverageHours - bookedCoverageHours;
      if (Math.abs(diff) < 0.25 || diff < 0) {
        coverageStatus = "fits";
      } else {
        coverageStatus = "exceeds";
        coverageOverageHours = Math.round(diff * 10) / 10;
      }
    }

    // ----- Persist (upsert by client_id) -------------------------------
    const row = {
      client_id,
      questionnaire_response_id: questionnaire_id,
      generated_at: new Date().toISOString(),
      generated_from: "auto",
      ceremony_start_time: ceremonyStart,
      ceremony_length_minutes: ceremonyLength,
      has_first_look: hasFirstLook,
      has_jewish_ketubah: hasJewishKetubah,
      has_wedding_party: hasWeddingParty,
      group_portrait_minutes: groupPortraitMinutes,
      getting_ready_address: grAddress || null,
      ceremony_address: cerAddress || null,
      reception_address: recAddress || null,
      travel_minutes_gr_to_ceremony: travelGrToCer,
      travel_minutes_ceremony_to_reception: travelCerToRec,
      sunset_time: sunsetTime,
      golden_hour_start_time: goldenHourStart,
      reception_events: sortedEvents,
      dinner_end_time: dinnerEnd,
      coverage_end_time: toHHMM(coverageEndM),
      has_extended_dancing: hasExtendedDancing,
      blocks,
      booked_coverage_hours: bookedCoverageHours,
      generated_coverage_hours: generatedCoverageHours,
      coverage_overage_hours: coverageOverageHours,
      coverage_status: coverageStatus,
    };

    const { data: up, error: upErr } = await admin
      .from("photography_timelines")
      .upsert(row, { onConflict: "client_id" })
      .select("id")
      .single();
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ timeline_id: up.id, blocks }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
