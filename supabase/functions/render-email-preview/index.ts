// Supabase Edge Function: render-email-preview
// Owner-only. Returns the rendered HTML + subject for a given email type using
// inline overrides (the user's unsaved edits) merged on top of saved overrides.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildPreviewEmail, EmailType } from "../_emails/renderers.ts";
import { loadCopyOverrides } from "../_emails/load_overrides.ts";
import { SAMPLE_CONTEXT } from "../_emails/copy_schemas.ts";

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
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", callerId).maybeSingle();
    if (!profile || profile.role !== "owner") {
      return new Response(JSON.stringify({ error: "forbidden — owner only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      email_type,
      overrides_inline,
      context,
    } = body as {
      email_type?: EmailType;
      overrides_inline?: Record<string, string>;
      context?: Record<string, string>;
    };

    if (!email_type) {
      return new Response(JSON.stringify({ error: "email_type required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Merge: saved overrides ← inline (live editor) overrides
    const saved = await loadCopyOverrides(admin, email_type);
    const overrides: Record<string, string> = { ...saved, ...(overrides_inline ?? {}) };
    const ctx = { ...SAMPLE_CONTEXT, ...(context ?? {}) };

    const { subject, html } = buildPreviewEmail(email_type, overrides, ctx);

    return new Response(JSON.stringify({ ok: true, subject, html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("render-email-preview error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
