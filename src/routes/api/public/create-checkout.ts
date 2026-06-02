import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import Stripe from "stripe";

const PAID_STATES = new Set(["paid", "refunded"]);
const CANCELLED_STATES = new Set(["cancelled", "kill_fee"]);

export const Route = createFileRoute("/api/public/create-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[create-checkout] env presence:", {
          SB_URL: !!process.env.SB_URL,
          SERVICE_ROLE_KEY: !!process.env.SERVICE_ROLE_KEY,
          STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
        });
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          console.error("[create-checkout] STRIPE_SECRET_KEY missing");
          return Response.json({ error: "stripe_not_configured" }, { status: 500 });
        }

        let body: { view_token?: string; invoice_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        console.log("[create-checkout] body:", {
          has_view_token: !!body.view_token,
          view_token_len: body.view_token?.length,
          invoice_id: body.invoice_id,
        });

        const token = body.view_token;
        const invoiceId = body.invoice_id;

        if (
          !token || typeof token !== "string" ||
          token.length < 16 || token.length > 256 ||
          !/^[a-zA-Z0-9_-]+$/.test(token)
        ) {
          console.warn("[create-checkout] reject invalid_token at validation");
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }
        if (!invoiceId || typeof invoiceId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
          console.warn("[create-checkout] reject invalid_invoice_id");
          return Response.json({ error: "invalid_invoice_id" }, { status: 400 });
        }

        // 1. Resolve token → client_id (server-side, never trust client)
        let recipient: { invoice_id: string } | null = null;
        try {
          const res = await supabaseAdmin
            .from("invoice_recipients")
            .select("invoice_id")
            .eq("view_token", token)
            .maybeSingle();
          console.log("[create-checkout] step1 recipient lookup:", { error: res.error?.message, found: !!res.data });
          recipient = res.data;
          if (res.error) throw res.error;
        } catch (e: any) {
          console.error("[create-checkout] step1 EXCEPTION", { name: e?.name, message: e?.message, code: e?.code, stack: e?.stack });
          return Response.json({ error: "step1_failed", detail: e?.message }, { status: 500 });
        }
        if (!recipient) {
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }

        const { data: anchor } = await supabaseAdmin
          .from("invoices")
          .select("client_id")
          .eq("id", recipient.invoice_id)
          .maybeSingle();
        if (!anchor?.client_id) {
          return Response.json({ error: "invalid_token" }, { status: 404 });
        }
        const clientId = anchor.client_id;

        // 2. Look up the REAL target invoice (server-side amount, server-side ownership check)
        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .select("id, client_id, label, total_cents, status")
          .eq("id", invoiceId)
          .maybeSingle();
        if (!invoice) {
          return Response.json({ error: "invoice_not_found" }, { status: 404 });
        }
        // Cross-couple guard — invoice must belong to the token's couple
        if (invoice.client_id !== clientId) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        if (PAID_STATES.has(invoice.status)) {
          return Response.json({ error: "already_paid" }, { status: 409 });
        }
        if (CANCELLED_STATES.has(invoice.status)) {
          return Response.json({ error: "cancelled" }, { status: 409 });
        }
        if (!invoice.total_cents || invoice.total_cents <= 0) {
          return Response.json({ error: "invalid_amount" }, { status: 400 });
        }

        // 3. Held / pending-change guard
        const { data: pending } = await supabaseAdmin
          .from("pending_changes")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "pending")
          .limit(1);
        if ((pending?.length ?? 0) > 0) {
          return Response.json({ error: "pending_change" }, { status: 409 });
        }

        // 4. Couple display name (for product label)
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("couple_name_1, couple_name_2")
          .eq("id", clientId)
          .maybeSingle();
        const coupleName = [client?.couple_name_1, client?.couple_name_2]
          .filter(Boolean).join(" & ") || "Couple";

        const label = invoice.label ?? "Invoice";
        const productName = `${label} — ${coupleName}`;

        // 5. Build URLs from the request origin
        const origin = (() => {
          const url = new URL(request.url);
          return `${url.protocol}//${url.host}`;
        })();
        const successUrl = `${origin}/pay/${encodeURIComponent(token)}?paid=1&inv=${encodeURIComponent(invoice.id)}`;
        const cancelUrl = `${origin}/pay/${encodeURIComponent(token)}`;

        // 6. Create the Checkout Session
        const stripe = new Stripe(stripeKey, {
          apiVersion: "2026-04-22.dahlia",
          httpClient: Stripe.createFetchHttpClient(),
        });
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.create({
            mode: "payment",
            client_reference_id: invoice.id,
            metadata: {
              invoice_id: invoice.id,
              client_id: clientId,
              view_token: token,
            },
            payment_intent_data: {
              metadata: {
                invoice_id: invoice.id,
                client_id: clientId,
              },
            },
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: invoice.total_cents, // server-side amount, NEVER from client
                  product_data: {
                    name: productName,
                  },
                },
              },
            ],
            // Omit payment_method_types so Stripe Checkout uses every method
            // enabled in the Dashboard (cards, ACH, Apple/Google Pay, etc.)
            success_url: successUrl,
            cancel_url: cancelUrl,
          });
        } catch (err: any) {
          console.error("[create-checkout] STRIPE ERROR FULL", {
            name: err?.name,
            message: err?.message,
            type: err?.type,
            code: err?.code,
            statusCode: err?.statusCode,
            requestId: err?.requestId,
            raw: err?.raw,
            stack: err?.stack,
          });
          return Response.json({ error: "stripe_error", detail: err?.message }, { status: 502 });
        }

        if (!session.url) {
          return Response.json({ error: "no_session_url" }, { status: 502 });
        }

        // 7. Store the session id on the invoice for later reconciliation
        await supabaseAdmin
          .from("invoices")
          .update({ stripe_checkout_session_id: session.id })
          .eq("id", invoice.id);

        return Response.json({ url: session.url });
      },
    },
  },
});
