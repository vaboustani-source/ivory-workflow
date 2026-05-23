
-- ============================================================
-- PHASE 2: repoint create_booking_invoices to quote.total_cents
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_booking_invoices(
  p_client_id uuid, p_template_id uuid, p_overrides jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_fee_pct numeric;
  v_fee_flat int;
  v_base_cents int;
  v_inst RECORD;
  v_due date;
  v_net int;
  v_gross int;
  v_fee int;
  v_subtotal int;
  v_total int;
  v_invoice_id uuid;
  v_invoice_ids uuid[] := '{}';
  v_override jsonb;
  v_label text;
  v_idx int := 0;
  v_total_count int;
  v_net_sum int := 0;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  -- Quote is now the authoritative source for booking amount.
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE client_id = p_client_id AND status = 'accepted'
  ORDER BY updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client has no accepted quote — cannot generate invoices.';
  END IF;

  v_base_cents := COALESCE(v_quote.total_cents, 0);
  IF v_base_cents <= 0 THEN
    RAISE EXCEPTION 'Accepted quote total is zero — cannot generate invoices.';
  END IF;

  -- Package still drives fee bake-in flag and naming; quote drives the dollars.
  IF v_client.package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages WHERE id = v_client.package_id;
  END IF;

  IF v_pkg.add_processing_fees THEN
    SELECT stripe_percentage, stripe_flat_cents INTO v_fee_pct, v_fee_flat
      FROM public.processing_fee_settings LIMIT 1;
    IF v_fee_pct IS NULL THEN
      RAISE EXCEPTION 'Processing fee settings not configured';
    END IF;
  END IF;

  IF v_client.wedding_date IS NULL AND EXISTS (
    SELECT 1 FROM public.payment_schedule_template_installments
    WHERE template_id = p_template_id AND due_offset_type = 'days_before_event'
  ) THEN
    RAISE EXCEPTION 'Set a wedding date before booking — payment schedule requires it.';
  END IF;

  SELECT COUNT(*) INTO v_total_count
    FROM public.payment_schedule_template_installments WHERE template_id = p_template_id;
  IF v_total_count = 0 THEN
    RAISE EXCEPTION 'Template has no installments';
  END IF;

  FOR v_inst IN
    SELECT * FROM public.payment_schedule_template_installments
    WHERE template_id = p_template_id
    ORDER BY sequence_order
  LOOP
    v_idx := v_idx + 1;

    v_due := CASE v_inst.due_offset_type
      WHEN 'on_booking' THEN CURRENT_DATE
      WHEN 'days_after_booking' THEN CURRENT_DATE + COALESCE(v_inst.due_offset_days,0)
      WHEN 'days_before_event' THEN v_client.wedding_date - COALESCE(v_inst.due_offset_days,0)
    END;

    v_label := v_inst.label;

    SELECT value INTO v_override
    FROM jsonb_array_elements(p_overrides) AS t(value)
    WHERE (value->>'installment_index')::int = v_idx - 1
    LIMIT 1;

    IF v_override IS NOT NULL THEN
      IF (v_override->>'due_date') IS NOT NULL THEN v_due := (v_override->>'due_date')::date; END IF;
      IF (v_override->>'label') IS NOT NULL THEN v_label := v_override->>'label'; END IF;
    END IF;

    -- Studio-never-short: last installment absorbs the rounding remainder
    -- so net installments sum EXACTLY to the quote total.
    IF v_idx = v_total_count THEN
      v_net := v_base_cents - v_net_sum;
    ELSE
      v_net := ROUND(v_base_cents::numeric * v_inst.percentage / 100)::int;
    END IF;
    v_net_sum := v_net_sum + v_net;

    IF v_pkg.add_processing_fees THEN
      v_gross := CEIL((v_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
      v_fee := v_gross - v_net;
      v_subtotal := v_net;
      v_total := v_gross;
    ELSE
      v_fee := 0;
      v_subtotal := v_net;
      v_total := v_net;
    END IF;

    INSERT INTO public.invoices (
      client_id, sequence_order, label, subtotal_cents, processing_fee_cents,
      total_cents, amount, due_date, status, currency, invoice_type
    ) VALUES (
      p_client_id, v_idx, v_label, v_subtotal, v_fee, v_total,
      v_total::numeric / 100, v_due, 'scheduled', 'USD',
      CASE
        WHEN v_idx = 1 THEN 'retainer'::invoice_type
        WHEN v_idx = v_total_count THEN 'final'::invoice_type
        ELSE 'other'::invoice_type
      END
    ) RETURNING id INTO v_invoice_id;

    INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
    VALUES (
      v_invoice_id,
      COALESCE(v_pkg.name, 'Wedding photography') || ' — Installment ' || v_idx || ' of ' || v_total_count || ' (' || v_label || ')',
      v_subtotal, 1
    );

    INSERT INTO public.invoice_recipients (invoice_id, name, email, role)
    VALUES (v_invoice_id, v_client.couple_name_1, v_client.primary_email, 'primary_client');

    v_invoice_ids := array_append(v_invoice_ids, v_invoice_id);

    PERFORM public._log_activity(
      'invoice.created', 'invoice', v_invoice_id,
      'Created invoice ' || v_idx || '/' || v_total_count || ': ' || v_label || ' ($' || ROUND(v_total/100.0,2)::text || ')',
      auth.uid(),
      jsonb_build_object('client_id', p_client_id, 'template_id', p_template_id, 'sequence_order', v_idx, 'source', 'quote', 'quote_id', v_quote.id)
    );
  END LOOP;

  UPDATE public.clients
    SET status = 'booked', booked_at = COALESCE(booked_at, now())
    WHERE id = p_client_id;

  PERFORM public._log_activity(
    'booking.confirmed', 'client', p_client_id,
    'Booking confirmed — ' || array_length(v_invoice_ids,1) || ' invoices created from quote ($' || ROUND(v_base_cents/100.0,2)::text || ')',
    auth.uid(),
    jsonb_build_object('template_id', p_template_id, 'invoice_ids', to_jsonb(v_invoice_ids), 'quote_id', v_quote.id, 'quote_total_cents', v_base_cents)
  );

  RETURN jsonb_build_object('success', true, 'invoice_ids', to_jsonb(v_invoice_ids), 'quote_total_cents', v_base_cents);
END;
$function$;

-- Deprecate the old source column (kept in place; no longer authoritative).
COMMENT ON COLUMN public.clients.package_price IS
  'DEPRECATED as invoicing source; quote.total_cents is now authoritative. Column kept for legacy display only.';

-- ============================================================
-- PHASE 3: backfill schedules for the 3 accepted-but-uninvoiced clients
-- Studio default template = the only one that exists: "Standard 3-payment"
-- (aeeef340-8a17-4f19-bffc-879d8d6d49e8)
-- ============================================================
DO $backfill$
DECLARE
  v_template_id uuid := 'aeeef340-8a17-4f19-bffc-879d8d6d49e8';
  v_client_id uuid;
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_fee_pct numeric;
  v_fee_flat int;
  v_base_cents int;
  v_inst RECORD;
  v_due date;
  v_net int; v_gross int; v_fee int; v_subtotal int; v_total int;
  v_invoice_id uuid;
  v_idx int;
  v_total_count int;
  v_net_sum int;
  v_client_ids uuid[] := ARRAY[
    '9cae6928-4da2-4ef9-87bb-84e73abab5b0'::uuid, -- Charlotte
    'e56b2344-62f3-4555-8e5b-68876bc56abe'::uuid, -- Isabella
    '9ad04193-fbea-4271-a1ac-571a270cb34d'::uuid  -- Sophia
  ];
BEGIN
  SELECT stripe_percentage, stripe_flat_cents INTO v_fee_pct, v_fee_flat
    FROM public.processing_fee_settings LIMIT 1;

  SELECT COUNT(*) INTO v_total_count
    FROM public.payment_schedule_template_installments WHERE template_id = v_template_id;

  FOREACH v_client_id IN ARRAY v_client_ids LOOP
    SELECT * INTO v_client FROM public.clients WHERE id = v_client_id;

    -- Guard: skip if invoices already exist (defensive — Phase 1 confirmed zero)
    IF EXISTS (SELECT 1 FROM public.invoices WHERE client_id = v_client_id) THEN
      RAISE NOTICE 'Skipping % — already has invoices', v_client.couple_name_1;
      CONTINUE;
    END IF;

    SELECT * INTO v_quote FROM public.quotes
      WHERE client_id = v_client_id AND status = 'accepted'
      ORDER BY updated_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE NOTICE 'Skipping % — no accepted quote', v_client.couple_name_1;
      CONTINUE;
    END IF;

    v_base_cents := v_quote.total_cents;
    v_pkg := NULL;
    IF v_client.package_id IS NOT NULL THEN
      SELECT * INTO v_pkg FROM public.packages WHERE id = v_client.package_id;
    END IF;

    v_idx := 0;
    v_net_sum := 0;

    FOR v_inst IN
      SELECT * FROM public.payment_schedule_template_installments
      WHERE template_id = v_template_id ORDER BY sequence_order
    LOOP
      v_idx := v_idx + 1;
      v_due := CASE v_inst.due_offset_type
        WHEN 'on_booking' THEN CURRENT_DATE
        WHEN 'days_after_booking' THEN CURRENT_DATE + COALESCE(v_inst.due_offset_days,0)
        WHEN 'days_before_event' THEN v_client.wedding_date - COALESCE(v_inst.due_offset_days,0)
      END;

      IF v_idx = v_total_count THEN
        v_net := v_base_cents - v_net_sum;
      ELSE
        v_net := ROUND(v_base_cents::numeric * v_inst.percentage / 100)::int;
      END IF;
      v_net_sum := v_net_sum + v_net;

      IF v_pkg.add_processing_fees THEN
        v_gross := CEIL((v_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
        v_fee := v_gross - v_net;
        v_subtotal := v_net; v_total := v_gross;
      ELSE
        v_fee := 0; v_subtotal := v_net; v_total := v_net;
      END IF;

      INSERT INTO public.invoices (
        client_id, sequence_order, label, subtotal_cents, processing_fee_cents,
        total_cents, amount, due_date, status, currency, invoice_type
      ) VALUES (
        v_client_id, v_idx, v_inst.label, v_subtotal, v_fee, v_total,
        v_total::numeric / 100, v_due, 'scheduled', 'USD',
        CASE
          WHEN v_idx = 1 THEN 'retainer'::invoice_type
          WHEN v_idx = v_total_count THEN 'final'::invoice_type
          ELSE 'other'::invoice_type
        END
      ) RETURNING id INTO v_invoice_id;

      INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
      VALUES (
        v_invoice_id,
        COALESCE(v_pkg.name, 'Wedding photography') || ' — Installment ' || v_idx || ' of ' || v_total_count || ' (' || v_inst.label || ')',
        v_subtotal, 1
      );

      INSERT INTO public.invoice_recipients (invoice_id, name, email, role)
      VALUES (v_invoice_id, v_client.couple_name_1, v_client.primary_email, 'primary_client');
    END LOOP;

    -- Net sanity check
    IF v_net_sum <> v_base_cents THEN
      RAISE EXCEPTION 'Schedule for % sums to % cents, expected %', v_client.couple_name_1, v_net_sum, v_base_cents;
    END IF;
  END LOOP;
END
$backfill$;
