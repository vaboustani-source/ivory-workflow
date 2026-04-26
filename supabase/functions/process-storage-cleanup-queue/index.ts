// Processes pending entries in storage_cleanup_queue whose scheduled_at <= now.
// Currently supports target_type = 'client_archive': removes all message attachments
// for the client's conversation from storage and the message_attachments table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "message-attachments";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: queue, error } = await supabase
      .from("storage_cleanup_queue")
      .select("id, target_type, target_id")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .limit(50);
    if (error) throw error;

    let processed = 0;
    let filesRemoved = 0;

    for (const item of queue ?? []) {
      try {
        if (item.target_type === "client_archive") {
          // Find conversation for this client
          const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("client_id", item.target_id)
            .maybeSingle();

          if (conv?.id) {
            // Get all messages for the conversation
            const { data: msgs } = await supabase
              .from("messages")
              .select("id")
              .eq("conversation_id", conv.id);
            const msgIds = (msgs ?? []).map((m: any) => m.id);
            if (msgIds.length) {
              const { data: atts } = await supabase
                .from("message_attachments")
                .select("id, storage_path")
                .in("message_id", msgIds);
              const paths = (atts ?? []).map((a: any) => a.storage_path).filter(Boolean);
              if (paths.length) {
                // Remove from storage in chunks
                for (let i = 0; i < paths.length; i += 100) {
                  const chunk = paths.slice(i, i + 100);
                  const { error: delErr } = await supabase.storage.from(BUCKET).remove(chunk);
                  if (!delErr) filesRemoved += chunk.length;
                }
                // Delete attachment rows
                const ids = (atts ?? []).map((a: any) => a.id);
                await supabase.from("message_attachments").delete().in("id", ids);
              }
            }
          }
        }

        await supabase
          .from("storage_cleanup_queue")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", item.id);
        processed += 1;
      } catch (innerErr) {
        await supabase
          .from("storage_cleanup_queue")
          .update({ status: "failed", processed_at: new Date().toISOString(), error_message: String(innerErr) })
          .eq("id", item.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, filesRemoved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-storage-cleanup-queue failed", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
