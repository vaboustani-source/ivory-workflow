// One-shot seed: create Margaux profile, reassign Isabella, seed Amelia proposal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (_req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const log: Record<string, unknown> = {};

  // 1. Auth user for Margaux (idempotent)
  let margauxId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === "margaux@storiesbyvictoria.com");
  if (existing) {
    margauxId = existing.id;
    log.margaux = "already-exists";
  } else {
    const { data: u, error: ue } = await admin.auth.admin.createUser({
      email: "margaux@storiesbyvictoria.com",
      email_confirm: true,
      user_metadata: { full_name: "Margaux Chen", role: "studio_manager" },
    });
    if (ue) return new Response(JSON.stringify({ step: "createUser", error: ue.message }), { status: 500 });
    margauxId = u.user.id;
    log.margaux = "created";
  }

  // ensure profile values
  await admin.from("profiles").update({ role: "studio_manager", full_name: "Margaux Chen" }).eq("id", margauxId);

  // 2. Reassign Isabella Moreau
  const { data: upd, error: re } = await admin
    .from("clients")
    .update({ manager_id: margauxId })
    .eq("couple_name_1", "Isabella Moreau")
    .select("id");
  if (re) return new Response(JSON.stringify({ step: "reassign", error: re.message, margauxId }), { status: 500 });
  log.reassigned = upd?.length ?? 0;

  // 3. Seed proposal for Amelia & Liam (skip if one already exists)
  const ameliaId = "e4b3202c-35f0-4aad-87af-d926b0e89a6f";
  const victoriaId = "15f705ca-8003-467d-8b38-48b1795a6ba3";
  const { data: existingProp } = await admin
    .from("proposals").select("id").eq("client_id", ameliaId).limit(1);
  if (existingProp && existingProp.length > 0) {
    log.proposal = "already-exists";
  } else {
    const sentAt = new Date(Date.now() - 2 * 86400000).toISOString();
    const validUntil = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
    const { error: pe } = await admin.from("proposals").insert({
      client_id: ameliaId, version: 1, status: "sent", sent_at: sentAt,
      total: 12000, valid_until: validUntil, created_by: victoriaId, created_at: sentAt,
    });
    if (pe) return new Response(JSON.stringify({ step: "proposal", error: pe.message }), { status: 500 });
    log.proposal = "inserted";
  }

  return new Response(JSON.stringify({ ok: true, margauxId, ...log }), {
    headers: { "content-type": "application/json" },
  });
});
