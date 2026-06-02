
-- 1. Add 'mismatch' to payment_attempt_status enum
ALTER TYPE public.payment_attempt_status ADD VALUE IF NOT EXISTS 'mismatch';

COMMIT;

-- 2. Atomic processing function for checkout.session.completed
CREATE OR REPLACE FUNCTION public.process_stripe_payment_succeeded(
  p_event_id text,
  p_event_type text,
  p_invoice_id uuid,
  p_amount_total int,
  p_stripe_payment_intent_id text,
  p_payment_method_last4 text,
  p_raw_event jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_couple_name text;
  v_conv_id uuid;
  v_attempt_id uuid;
  v_amount_dollars text;
BEGIN
  -- Idempotency: if event already recorded, no-op
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE stripe_event_id = p_event_id) THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invoice_not_found');
  END IF;

  -- Amount guard
  IF v_invoice.total_cents IS DISTINCT FROM p_amount_total THEN
    INSERT INTO public.payment_attempts (
      invoice_id, amount_cents, status, stripe_event_id, stripe_event_type, raw_event
    ) VALUES (
      p_invoice_id, p_amount_total, 'mismatch', p_event_id, p_event_type, p_raw_event
    );
    PERFORM public._notify_all_owners(
      'payment_mismatch',
      'Payment amount mismatch',
      'Stripe reported ' || (p_amount_total::numeric/100)::text || ' for invoice "' || COALESCE(v_invoice.label,'Invoice') || '" but the invoice total is ' || (COALESCE(v_invoice.total_cents,0)::numeric/100)::text || '. NOT marked paid — review immediately.',
      '/studio/clients/' || v_invoice.client_id::text
    );
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;

  -- Status guard
  IF v_invoice.status::text IN ('paid','cancelled','refunded','kill_fee') THEN
    INSERT INTO public.payment_attempts (
      invoice_id, amount_cents, status, stripe_event_id, stripe_event_type, raw_event
    ) VALUES (
      p_invoice_id, p_amount_total, 'succeeded', p_event_id, p_event_type, p_raw_event
    );
    RETURN jsonb_build_object('status', 'already_terminal', 'invoice_status', v_invoice.status::text);
  END IF;

  -- Mark paid
  UPDATE public.invoices
    SET status = 'paid',
        paid_at = now(),
        stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
        payment_method_last4 = COALESCE(p_payment_method_last4, payment_method_last4),
        updated_at = now()
  WHERE id = p_invoice_id;

  -- Record attempt
  INSERT INTO public.payment_attempts (
    invoice_id, amount_cents, status, stripe_event_id, stripe_event_type, raw_event
  ) VALUES (
    p_invoice_id, p_amount_total, 'succeeded', p_event_id, p_event_type, p_raw_event
  ) RETURNING id INTO v_attempt_id;

  -- Activity log
  PERFORM public._log_activity(
    'invoice.paid','invoice', p_invoice_id,
    'Payment received: ' || COALESCE(v_invoice.label,'Invoice') || ' — $' || (p_amount_total::numeric/100)::text,
    NULL,
    jsonb_build_object('client_id', v_invoice.client_id, 'amount_cents', p_amount_total, 'stripe_event_id', p_event_id)
  );

  -- Couple display
  SELECT COALESCE(couple_name_1,'') || COALESCE(' & ' || couple_name_2,'') INTO v_couple_name
    FROM public.clients WHERE id = v_invoice.client_id;

  v_amount_dollars := to_char((p_amount_total::numeric/100), 'FM999,999,990.00');

  -- System message in couple conversation
  SELECT id INTO v_conv_id FROM public.conversations WHERE client_id = v_invoice.client_id;
  IF v_conv_id IS NULL AND v_invoice.client_id IS NOT NULL THEN
    INSERT INTO public.conversations (client_id) VALUES (v_invoice.client_id) RETURNING id INTO v_conv_id;
  END IF;
  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.messages (conversation_id, sender_id, content, is_internal_note)
    VALUES (v_conv_id, NULL,
      'Payment received: ' || COALESCE(v_invoice.label,'Invoice') || ' — $' || v_amount_dollars,
      false);
  END IF;

  -- Notify owners
  PERFORM public._notify_all_owners(
    'payment_received',
    'Payment received — $' || v_amount_dollars,
    COALESCE(v_couple_name,'Couple') || ' paid "' || COALESCE(v_invoice.label,'Invoice') || '".',
    '/studio/clients/' || v_invoice.client_id::text
  );

  RETURN jsonb_build_object('status','succeeded','attempt_id', v_attempt_id);
END $$;

GRANT EXECUTE ON FUNCTION public.process_stripe_payment_succeeded(
  text, text, uuid, int, text, text, jsonb
) TO service_role;
