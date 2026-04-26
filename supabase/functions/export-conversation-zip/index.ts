// Streams a ZIP of all attachments for a given client_id (owner-only).
// POST { client_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { BlobWriter, ZipWriter } from "https://deno.land/x/zipjs@v2.7.45/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "message-attachments";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "owner") {
      return new Response("Forbidden — owner only", { status: 403, headers: corsHeaders });
    }

    const { client_id } = await req.json();
    if (!client_id) return new Response("client_id required", { status: 400, headers: corsHeaders });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: client } = await admin.from("clients").select("couple_name_1, couple_name_2").eq("id", client_id).maybeSingle();
    const { data: conv } = await admin.from("conversations").select("id").eq("client_id", client_id).maybeSingle();
    if (!conv) return new Response("No conversation for client", { status: 404, headers: corsHeaders });

    const { data: msgs } = await admin.from("messages").select("id").eq("conversation_id", conv.id);
    const msgIds = (msgs ?? []).map((m: any) => m.id);
    if (msgIds.length === 0) return new Response("No messages", { status: 404, headers: corsHeaders });

    const { data: atts } = await admin
      .from("message_attachments")
      .select("file_name, storage_path, created_at, message_id")
      .in("message_id", msgIds)
      .order("created_at", { ascending: true });

    const list = atts ?? [];
    if (list.length === 0) return new Response("No attachments", { status: 404, headers: corsHeaders });

    const zipFileWriter = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipFileWriter);
    const seen = new Map<string, number>();

    for (const a of list) {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(a.storage_path);
      if (error || !blob) { console.warn("download failed", a.storage_path, error?.message); continue; }
      let name = a.file_name;
      const count = seen.get(name) ?? 0;
      if (count > 0) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
      }
      seen.set(a.file_name, count + 1);
      // @ts-ignore - zipjs accepts Blob/ReadableStream
      await zipWriter.add(name, blob.stream());
    }
    await zipWriter.close();
    const zipBlob = await zipFileWriter.getData();

    const safeName = `${client?.couple_name_1 ?? "client"}${client?.couple_name_2 ? "-" + client.couple_name_2 : ""}-attachments.zip`
      .replace(/[^A-Za-z0-9._-]+/g, "_");

    return new Response(zipBlob, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  } catch (e) {
    console.error("export-conversation-zip failed", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
