// Edge Function: compute-sunset-time
// Input: { lat: number, lng: number, date_iso: string (YYYY-MM-DD) }
// Output: { sunset_local: "HH:MM", golden_hour_start: "HH:MM" }
// Uses sunrise-sunset.org public API (no key). Returns time in the local TZ of lat/lng (approximated by UTC offset from longitude).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtLocal(utcIso: string, lng: number, tzOffsetMinutes?: number): string {
  // If we don't know the precise tz, approximate: each 15° of longitude = 1 hour
  const offsetMin = tzOffsetMinutes ?? Math.round((lng / 15) * 60);
  const d = new Date(utcIso);
  const local = new Date(d.getTime() + offsetMin * 60 * 1000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function subtractMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  let total = h * 60 + m - mins;
  if (total < 0) total += 24 * 60;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { lat, lng, date_iso, tz_offset_minutes } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number" || !date_iso) {
      return new Response(JSON.stringify({ error: "lat, lng, date_iso required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date_iso}&formatted=0`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.status !== "OK" || !j.results?.sunset) {
      return new Response(JSON.stringify({ error: `sunset_failed: ${j.status}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sunsetLocal = fmtLocal(j.results.sunset, lng, tz_offset_minutes);
    const goldenHourStart = subtractMinutes(sunsetLocal, 70);
    return new Response(JSON.stringify({ sunset_local: sunsetLocal, golden_hour_start: goldenHourStart }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
