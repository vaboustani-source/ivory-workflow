// Edge Function: geocode-address
// Input: { address: string }
// Output: { lat: number, lng: number, formatted_address: string }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { address } = await req.json();
    if (!address) {
      return new Response(JSON.stringify({ error: "address required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.status !== "OK" || !j.results?.length) {
      return new Response(JSON.stringify({ error: `geocode_failed: ${j.status}`, raw: j.error_message ?? null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const top = j.results[0];
    return new Response(JSON.stringify({
      lat: top.geometry.location.lat,
      lng: top.geometry.location.lng,
      formatted_address: top.formatted_address,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
