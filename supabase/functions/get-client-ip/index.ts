// Supabase Edge Function: get-client-ip
// Returns the caller's IP address and User-Agent so the browser can record
// them as part of a contract signature audit trail. Authenticated only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cloudflare/Supabase put the real client IP in cf-connecting-ip first,
    // then x-real-ip, and finally the leftmost entry of x-forwarded-for.
    const fwd = req.headers.get("x-forwarded-for") ?? "";
    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      (fwd ? fwd.split(",")[0].trim() : "") ||
      "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";

    return new Response(
      JSON.stringify({ ip, user_agent: userAgent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("get-client-ip error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
