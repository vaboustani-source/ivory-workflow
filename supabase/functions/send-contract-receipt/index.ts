// Supabase Edge Function: send-contract-receipt
// Emails the couple a confirmation that their contract has been signed,
// including signature audit details (typed name, IP, timestamp).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendEmail } from "../_emails/send.ts";
import { BRAND } from "../_emails/brand.ts";
import { buildContractReceipt } from "../_emails/renderers.ts";
import { loadCopyOverrides } from "../_emails/load_overrides.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id ?? null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { signature_id } = body ?? {};
    if (!signature_id) {
      return new Response(JSON.stringify({ error: "signature_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sig } = await admin
      .from("contract_signatures")
      .select("id, contract_id, client_id, typed_name, ip_address, signed_at, signed_by_user_id")
      .eq("id", signature_id)
      .maybeSingle();
    if (!sig) {
      return new Response(JSON.stringify({ error: "signature not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: the signer themselves OR a studio user can trigger this.
    const { data: callerProfile } = await admin
      .from("profiles").select("role").eq("id", callerId).maybeSingle();
    const isStudio = callerProfile && ["owner","studio_manager","associate_photographer"].includes(callerProfile.role);
    if (!isStudio && sig.signed_by_user_id !== callerId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: contract }, { data: client }] = await Promise.all([
      admin.from("contracts").select("id, title, content").eq("id", sig.contract_id).maybeSingle(),
      admin.from("clients").select("couple_name_1, couple_name_2, primary_email, secondary_email").eq("id", sig.client_id).maybeSingle(),
    ]);

    const recipients = [client?.primary_email, client?.secondary_email].filter(Boolean) as string[];
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, emailed: false, warn: "no_recipients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const coupleNames = `${client?.couple_name_1 ?? ""}${client?.couple_name_2 ? ` & ${client.couple_name_2}` : ""}`;
    const signedAtFmt = new Date(sig.signed_at).toLocaleString("en-US", {
      dateStyle: "long", timeStyle: "short", timeZone: "UTC",
    }) + " UTC";

    const overrides = await loadCopyOverrides(admin, "contract_receipt");
    const ctx: Record<string, string> = {
      couple_first_names: client?.couple_name_1 ?? "",
      couple_full_names: coupleNames,
      studio_name: BRAND.studioName,
      contract_title: contract?.title ?? "Wedding contract",
      signer_name: sig.typed_name,
    };

    const { subject, html } = buildContractReceipt(overrides, ctx, {
      contractTitle: contract?.title ?? "Wedding contract",
      signedAtFormatted: signedAtFmt,
      ipAddress: sig.ip_address ?? "—",
      signerName: sig.typed_name,
    });

    const sendResult = await sendEmail({ to: recipients, subject, html });
    if (!sendResult.emailed) {
      return new Response(JSON.stringify({ ok: true, emailed: false, warn: sendResult.warn }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log to activity feed
    await admin.from("activity_log").insert({
      user_id: sig.signed_by_user_id,
      action_type: "contract.signed",
      target_type: "contract",
      target_id: sig.contract_id,
      description: `Contract signed by ${sig.typed_name}`,
      metadata: { signature_id: sig.id, client_id: sig.client_id },
    });

    return new Response(JSON.stringify({ ok: true, emailed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-contract-receipt error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
