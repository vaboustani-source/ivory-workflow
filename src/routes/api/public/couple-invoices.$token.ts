import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/couple-invoices/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || token.length < 16 || token.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }

        // Resolve token -> recipient -> invoice -> client
        const { data: recipient } = await supabaseAdmin
          .from("invoice_recipients")
          .select("invoice_id")
          .eq("view_token", token)
          .maybeSingle();

        if (!recipient) {
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }

        const { data: anchorInvoice } = await supabaseAdmin
          .from("invoices")
          .select("client_id")
          .eq("id", recipient.invoice_id)
          .maybeSingle();

        if (!anchorInvoice?.client_id) {
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }

        const clientId = anchorInvoice.client_id;

        const [clientRes, invoicesRes, pendingRes] = await Promise.all([
          supabaseAdmin
            .from("clients")
            .select("couple_name_1, couple_name_2, wedding_date")
            .eq("id", clientId)
            .maybeSingle(),
          supabaseAdmin
            .from("invoices")
            .select("id, label, due_date, total_cents, status, sequence_order, paid_at")
            .eq("client_id", clientId)
            .order("sequence_order", { ascending: true, nullsFirst: false })
            .order("due_date", { ascending: true }),
          supabaseAdmin
            .from("pending_changes")
            .select("id")
            .eq("client_id", clientId)
            .eq("status", "pending")
            .limit(1),
        ]);

        const hasPendingChange = (pendingRes.data?.length ?? 0) > 0;

        return Response.json({
          couple: {
            name_1: clientRes.data?.couple_name_1 ?? null,
            name_2: clientRes.data?.couple_name_2 ?? null,
            wedding_date: clientRes.data?.wedding_date ?? null,
          },
          invoices: (invoicesRes.data ?? []).map((i) => ({
            id: i.id,
            label: i.label,
            due_date: i.due_date,
            total_cents: i.total_cents,
            status: i.status,
            sequence_order: i.sequence_order,
            paid_at: i.paid_at,
          })),
          has_pending_change: hasPendingChange,
        });
      },
    },
  },
});
