import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import Stripe from "stripe";

// Stripe webhook handler.
// - Public (Stripe POSTs from the outside) but authenticated by the Stripe
//   webhook signature (STRIPE_WEBHOOK_SECRET). NEVER trust the body otherwise.
// - Idempotent via payment_attempts.stripe_event_id unique constraint.
// - All "mark paid" work happens in a single SECURITY DEFINER DB function
//   so the invoice update + payment_attempt + activity log + system message
//   + owner notification are atomic.
export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        console.log("[stripe-webhook] env presence:", {
          STRIPE_SECRET_KEY: !!stripeKey,
          STRIPE_WEBHOOK_SECRET: !!webhookSecret,
          SB_URL: !!process.env.SB_URL,
          SERVICE_ROLE_KEY: !!process.env.SERVICE_ROLE_KEY,
        });
        if (!stripeKey || !webhookSecret) {
          console.error("[stripe-webhook] missing required env");
          return new Response("stripe_not_configured", { status: 500 });
        }

        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          console.warn("[stripe-webhook] missing stripe-signature header");
          return new Response("missing_signature", { status: 400 });
        }

        // Raw bytes — MUST be the un-parsed body for signature verification
        const rawBody = await request.text();

        const stripe = new Stripe(stripeKey, {
          apiVersion: "2026-04-22.dahlia",
          httpClient: Stripe.createFetchHttpClient(),
        });

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(
            rawBody,
            signature,
            webhookSecret,
          );
        } catch (err: any) {
          console.error("[stripe-webhook] signature verification FAILED", {
            message: err?.message,
          });
          return new Response(`invalid_signature: ${err?.message}`, { status: 400 });
        }

        console.log("[stripe-webhook] event verified:", {
          id: event.id,
          type: event.type,
        });

        // Idempotency: short-circuit if we've already recorded this event
        try {
          const { data: existing } = await supabaseAdmin
            .from("payment_attempts")
            .select("id")
            .eq("stripe_event_id", event.id)
            .maybeSingle();
          if (existing) {
            console.log("[stripe-webhook] duplicate event, ignoring", { id: event.id });
            return new Response("duplicate", { status: 200 });
          }
        } catch (e: any) {
          console.error("[stripe-webhook] idempotency check failed", { message: e?.message });
          // Fall through — the DB function also re-checks and will no-op if dup.
        }

        try {
          switch (event.type) {
            case "checkout.session.completed":
              return await handleCheckoutCompleted(stripe, event);
            case "payment_intent.payment_failed":
              return await handlePaymentFailed(event);
            case "charge.refunded":
              return await handleChargeRefunded(event);
            case "charge.dispute.created":
              return await handleDisputeCreated(event);
            default:
              console.log("[stripe-webhook] unhandled event type", { type: event.type, id: event.id });
              return new Response("unhandled", { status: 200 });
          }
        } catch (err: any) {
          console.error("[stripe-webhook] handler EXCEPTION", {
            type: event.type,
            id: event.id,
            name: err?.name,
            message: err?.message,
            stack: err?.stack,
          });
          // Return 500 so Stripe retries — we have NOT recorded the event.
          return new Response(`handler_error: ${err?.message}`, { status: 500 });
        }
      },
    },
  },
});

async function handleCheckoutCompleted(stripe: Stripe, event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const invoiceId = session.metadata?.invoice_id;
  const clientId = session.metadata?.client_id;

  if (!invoiceId || !clientId) {
    console.error("[stripe-webhook] checkout.session.completed missing metadata", {
      session_id: session.id,
      metadata: session.metadata,
    });
    // Record nothing — but return 200 so Stripe doesn't retry forever.
    return new Response("missing_metadata", { status: 200 });
  }

  // Pull payment intent / last4 if available
  let paymentIntentId: string | null = null;
  let last4: string | null = null;
  if (typeof session.payment_intent === "string") {
    paymentIntentId = session.payment_intent;
  } else if (session.payment_intent && typeof session.payment_intent === "object") {
    paymentIntentId = (session.payment_intent as Stripe.PaymentIntent).id;
  }
  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge.payment_method_details"],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      const card = charge?.payment_method_details?.card;
      if (card?.last4) last4 = card.last4;
    } catch (e: any) {
      console.warn("[stripe-webhook] failed to expand payment_intent", { message: e?.message });
    }
  }

  const { data, error } = await supabaseAdmin.rpc(
    "process_stripe_payment_succeeded",
    {
      p_event_id: event.id,
      p_event_type: event.type,
      p_invoice_id: invoiceId,
      p_amount_total: session.amount_total ?? 0,
      p_stripe_payment_intent_id: paymentIntentId,
      p_payment_method_last4: last4,
      p_raw_event: event,
    } as never,
  );

  if (error) {
    console.error("[stripe-webhook] process_stripe_payment_succeeded FAILED", {
      message: error.message,
      details: error.details,
    });
    return new Response(`db_error: ${error.message}`, { status: 500 });
  }

  console.log("[stripe-webhook] checkout.session.completed processed", { id: event.id, result: data });
  return new Response("ok", { status: 200 });
}

async function handlePaymentFailed(event: Stripe.Event) {
  const pi = event.data.object as Stripe.PaymentIntent;
  const invoiceId = pi.metadata?.invoice_id;
  if (!invoiceId) {
    console.warn("[stripe-webhook] payment_failed missing invoice_id metadata", { id: pi.id });
    return new Response("missing_metadata", { status: 200 });
  }
  const { error } = await supabaseAdmin.from("payment_attempts").insert({
    invoice_id: invoiceId,
    amount_cents: pi.amount ?? 0,
    status: "failed",
    stripe_event_id: event.id,
    stripe_event_type: event.type,
    raw_event: event as never,
  } as never);
  if (error) {
    console.error("[stripe-webhook] payment_failed insert failed", { message: error.message });
    return new Response(`db_error: ${error.message}`, { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

async function handleChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  const invoiceId = charge.metadata?.invoice_id
    ?? (typeof charge.payment_intent === "string" ? undefined : (charge.payment_intent as Stripe.PaymentIntent | null)?.metadata?.invoice_id);
  if (!invoiceId) {
    console.warn("[stripe-webhook] charge.refunded missing invoice_id metadata", { id: charge.id });
    return new Response("missing_metadata", { status: 200 });
  }
  const { error } = await supabaseAdmin.from("payment_attempts").insert({
    invoice_id: invoiceId,
    amount_cents: charge.amount_refunded ?? 0,
    status: "refunded",
    stripe_event_id: event.id,
    stripe_event_type: event.type,
    raw_event: event as never,
  } as never);
  if (error) {
    console.error("[stripe-webhook] charge.refunded insert failed", { message: error.message });
    return new Response(`db_error: ${error.message}`, { status: 500 });
  }
  // Notify owners — refund needs human review
  try {
    await supabaseAdmin.rpc("_notify_all_owners" as never, {
      p_kind: "payment_refunded",
      p_title: "Refund issued in Stripe",
      p_body: "A refund was recorded in Stripe. Invoice was NOT auto-flipped — please review.",
      p_link_to: null,
    } as never);
  } catch (e: any) {
    console.warn("[stripe-webhook] notify failed", { message: e?.message });
  }
  return new Response("ok", { status: 200 });
}

async function handleDisputeCreated(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const invoiceId =
    (dispute.metadata as Record<string, string> | undefined)?.invoice_id
    ?? (typeof dispute.payment_intent === "string" ? undefined : (dispute.payment_intent as Stripe.PaymentIntent | null)?.metadata?.invoice_id);
  if (!invoiceId) {
    console.warn("[stripe-webhook] dispute.created missing invoice_id metadata", { id: dispute.id });
    return new Response("missing_metadata", { status: 200 });
  }
  const { error } = await supabaseAdmin.from("payment_attempts").insert({
    invoice_id: invoiceId,
    amount_cents: dispute.amount ?? 0,
    status: "disputed",
    stripe_event_id: event.id,
    stripe_event_type: event.type,
    raw_event: event as unknown as Record<string, unknown>,
  });
  if (error) {
    console.error("[stripe-webhook] dispute.created insert failed", { message: error.message });
    return new Response(`db_error: ${error.message}`, { status: 500 });
  }
  await supabaseAdmin.rpc("_notify_all_owners" as never, {
    p_kind: "payment_disputed",
    p_title: "Chargeback opened — urgent",
    p_body: "A customer has disputed a charge in Stripe. Respond from the Stripe dashboard ASAP.",
    p_link_to: null,
  } as never).catch(() => {});
  return new Response("ok", { status: 200 });
}
