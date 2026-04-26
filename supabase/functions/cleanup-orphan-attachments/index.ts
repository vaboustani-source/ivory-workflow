// Cleanup orphan storage objects in the message-attachments bucket.
// An object is orphan if its path is not referenced by any message_attachments.storage_path
// AND it is not under a /temp/ folder less than 24h old.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "message-attachments";

async function listAll(supabase: ReturnType<typeof createClient>, prefix: string): Promise<string[]> {
  // Recursively list all object paths under prefix using offset-based pagination.
  const out: string[] = [];
  const stack: string[] = [prefix];
  while (stack.length) {
    const p = stack.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(p || undefined, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) { console.warn("list error", p, error.message); break; }
      if (!data || data.length === 0) break;
      for (const item of data) {
        const full = p ? `${p}/${item.name}` : item.name;
        // A folder has no id (Supabase quirk: folders show as items with null id/metadata).
        if (item.id === null || (!item.metadata && item.name && !item.name.includes("."))) {
          stack.push(full);
        } else {
          out.push(full);
        }
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";

    // 1) All known storage_paths from DB
    const { data: rows, error: rowsErr } = await supabase
      .from("message_attachments")
      .select("storage_path");
    if (rowsErr) throw rowsErr;
    const known = new Set((rows ?? []).map((r: any) => r.storage_path).filter(Boolean));

    // 2) List storage objects (top-level conversation folders)
    const allPaths = await listAll(supabase, "");

    const tempCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];
    for (const p of allPaths) {
      if (known.has(p)) continue;
      // Skip recent /temp/ uploads
      if (p.includes("/temp/")) {
        // We can't easily get created_at from list; conservatively keep temp paths.
        // The composer cleans up temp on remove; old ones will be deleted next run if
        // we add an mtime check — for now we let them age out via DB (no DB row -> orphan).
        continue;
      }
      toDelete.push(p);
    }

    let deleted = 0;
    if (!dryRun && toDelete.length > 0) {
      // Delete in chunks of 100
      for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const { error } = await supabase.storage.from(BUCKET).remove(chunk);
        if (error) { console.warn("remove error", error.message); continue; }
        deleted += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, total_objects: allPaths.length, known: known.size, orphans: toDelete.length, deleted, dryRun }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("cleanup-orphan-attachments failed", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
