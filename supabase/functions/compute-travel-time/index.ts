// Edge Function: compute-travel-time
// Input: { from_address: string, to_address: string }
// Output: { duration_minutes: number, distance_meters: number }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { from_address, to_address } = await req.json();
    if (!from_address || !to_address) {
      return new Response(JSON.stringify({ error: "from_address, to_address required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from_address)}&destinations=${encodeURIComponent(to_address)}&mode=driving&key=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    const el = j.rows?.[0]?.elements?.[0];
    if (j.status !== "OK" || !el || el.status !== "OK") {
      return new Response(JSON.stringify({ error: `travel_failed: ${j.status}/${el?.status}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      duration_minutes: Math.round(el.duration.value / 60),
      distance_meters: el.distance.value,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
