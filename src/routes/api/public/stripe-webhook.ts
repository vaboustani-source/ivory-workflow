import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import Stripe from "stripe";
import { renderPaymentReceived } from "@/lib/emails/payment-received.server";
import { sendEmail, POSTMARK_DEFAULTS } from "@/integrations/postmark/client.server";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

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

  // ── Stage 6: payment confirmation email (feature-flagged) ────────────
  const result = (data ?? {}) as { status?: string };
  if (
    process.env.EMAIL_PAYMENT_CONFIRMATION_ENABLED === "true" &&
    result.status === "succeeded"
  ) {
    try {
      await sendPaymentConfirmationEmail({
        invoiceId,
        clientId,
        amountCents: session.amount_total ?? 0,
        stripeEventId: event.id,
      });
    } catch (e: any) {
      // Never fail the webhook because of an email — payment is recorded.
      console.error("[stripe-webhook] payment confirmation email threw", {
        message: e?.message,
        stack: e?.stack,
      });
    }
  } else {
    console.log("[stripe-webhook] payment confirmation email skipped", {
      enabled: process.env.EMAIL_PAYMENT_CONFIRMATION_ENABLED === "true",
      status: result.status,
    });
  }

  return new Response("ok", { status: 200 });
}

interface SendConfirmationArgs {
  invoiceId: string;
  clientId: string;
  amountCents: number;
  stripeEventId: string;
}

async function sendPaymentConfirmationEmail(args: SendConfirmationArgs): Promise<void> {
  // Idempotency: if we've already sent a payment_received email for this
  // invoice, log a skipped_duplicate row and bail. Prevents double-send on
  // webhook retries / manual replay.
  const { data: existing } = await supabaseAdmin
    .from("email_sends")
    .select("id")
    .eq("template_key", "payment_received")
    .eq("invoice_id", args.invoiceId)
    .eq("status", "sent")
    .maybeSingle();

  if (existing) {
    console.log("[stripe-webhook] payment_received email already sent — skipping", {
      invoice_id: args.invoiceId,
      existing_id: existing.id,
    });
    const skipPayload: TablesInsert<"email_sends"> = {
      to_address: "(skipped)",
      from_address: POSTMARK_DEFAULTS.from,
      reply_to: POSTMARK_DEFAULTS.replyTo,
      subject: "(skipped: already sent)",
      template_key: "payment_received",
      client_id: args.clientId,
      invoice_id: args.invoiceId,
      status: "skipped_duplicate",
      tag: "payment_received",
      metadata: {
        stripe_event_id: args.stripeEventId,
        prior_send_id: existing.id,
      } as Json,
    };
    await supabaseAdmin.from("email_sends").insert(skipPayload);
    return;
  }

  // Gather data for personalization
  const [{ data: client, error: clientErr }, { data: invoice, error: invErr }, { count: totalCount }] =
    await Promise.all([
      supabaseAdmin
        .from("clients")
        .select("couple_name_1, couple_name_2, primary_email, secondary_email, wedding_date")
        .eq("id", args.clientId)
        .maybeSingle(),
      supabaseAdmin
        .from("invoices")
        .select("label, sequence_order")
        .eq("id", args.invoiceId)
        .maybeSingle(),
      supabaseAdmin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("client_id", args.clientId),
    ]);

  if (clientErr || invErr || !client || !invoice) {
    console.error("[stripe-webhook] failed to load client/invoice for email", {
      clientErr: clientErr?.message,
      invErr: invErr?.message,
    });
    return;
  }
  if (!client.primary_email) {
    console.warn("[stripe-webhook] client has no primary_email — skipping email", {
      client_id: args.clientId,
    });
    return;
  }

  // Remaining balance (after this payment — the RPC just marked this invoice paid).
  const { data: unpaid } = await supabaseAdmin
    .from("invoices")
    .select("total_cents")
    .eq("client_id", args.clientId)
    .not("status", "in", "(paid,cancelled,refunded,kill_fee)");
  const remainingCents =
    (unpaid ?? []).reduce((sum, r: any) => sum + (r.total_cents ?? 0), 0);

  const rendered = renderPaymentReceived({
    coupleName1: client.couple_name_1 ?? "",
    coupleName2: client.couple_name_2 ?? null,
    amountCents: args.amountCents,
    invoiceLabel: invoice.label ?? "Invoice",
    sequenceOrder: invoice.sequence_order ?? null,
    totalInvoiceCount: totalCount ?? 0,
    dateReceived: new Date(),
    remainingBalanceCents: remainingCents,
    weddingDate: client.wedding_date ?? null,
  });

  // Build recipient list — CC secondary if present & distinct
  const to = client.primary_email;
  const cc =
    client.secondary_email &&
    client.secondary_email.toLowerCase() !== client.primary_email.toLowerCase()
      ? client.secondary_email
      : undefined;
  // Postmark "To" supports comma-separated; we put CC there too since our
  // sendEmail helper exposes To only. They'll all see each other.
  const recipients = cc ? [to, cc] : to;

  const sendResult = await sendEmail({
    to: recipients,
    subject: rendered.subject,
    htmlBody: rendered.htmlBody,
    textBody: rendered.textBody,
    tag: "payment_received",
    metadata: {
      client_id: args.clientId,
      invoice_id: args.invoiceId,
      stripe_event_id: args.stripeEventId,
    },
  });

  const status = sendResult.success
    ? "sent"
    : sendResult.errorCode === "405" ||
        /test mode|approved sender/i.test(sendResult.error ?? "")
      ? "test_mode_blocked"
      : "failed";

  const logPayload: TablesInsert<"email_sends"> = {
    to_address: Array.isArray(recipients) ? recipients.join(", ") : recipients,
    from_address: POSTMARK_DEFAULTS.from,
    reply_to: POSTMARK_DEFAULTS.replyTo,
    subject: rendered.subject,
    template_key: "payment_received",
    client_id: args.clientId,
    invoice_id: args.invoiceId,
    postmark_message_id: sendResult.messageId ?? null,
    status,
    error_message: sendResult.error ?? null,
    error_code: sendResult.errorCode ?? null,
    tag: "payment_received",
    metadata: {
      stripe_event_id: args.stripeEventId,
    } as Json,
    raw_response: (sendResult.rawResponse ?? null) as Json | null,
  };
  await supabaseAdmin.from("email_sends").insert(logPayload);

  if (!sendResult.success) {
    // Don't throw — webhook stays 200. Notify owners so they can follow up manually.
    const coupleDisplay =
      `${client.couple_name_1 ?? ""}${client.couple_name_2 ? " & " + client.couple_name_2 : ""}`.trim() ||
      "the couple";
    try {
      await supabaseAdmin.rpc("_notify_all_owners" as never, {
        p_kind: "email_failed",
        p_title: "Payment confirmation email failed to send",
        p_body: `Payment was recorded but the confirmation email to ${coupleDisplay} failed (${sendResult.error ?? "unknown"}). Please contact them manually.`,
        p_link_to: `/studio/clients/${args.clientId}`,
      } as never);
    } catch (e: any) {
      console.warn("[stripe-webhook] notify owners (email_failed) failed", { message: e?.message });
    }
  }
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
    raw_event: event as never,
  } as never);
  if (error) {
    console.error("[stripe-webhook] dispute.created insert failed", { message: error.message });
    return new Response(`db_error: ${error.message}`, { status: 500 });
  }
  try {
    await supabaseAdmin.rpc("_notify_all_owners" as never, {
      p_kind: "payment_disputed",
      p_title: "Chargeback opened — urgent",
      p_body: "A customer has disputed a charge in Stripe. Respond from the Stripe dashboard ASAP.",
      p_link_to: null,
    } as never);
  } catch (e: any) {
    console.warn("[stripe-webhook] notify failed", { message: e?.message });
  }
  return new Response("ok", { status: 200 });
}
