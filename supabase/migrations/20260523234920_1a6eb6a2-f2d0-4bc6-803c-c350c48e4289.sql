
-- =====================================================================
-- B3: post-booking add — distribute added net across unpaid installments
-- Replaces add_quote_item with a version that also handles distribution
-- when the quote is already accepted (live payment schedule exists).
--
-- TODO(B4): gate post-booking adds for managers via approval workflow.
-- For now this is owner-direct (any studio user with add_quote_item access).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.add_quote_item(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric DEFAULT 1,
  p_custom_description text DEFAULT NULL::text,
  p_custom_price_cents integer DEFAULT NULL::integer,
  p_display_order integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_item public.service_items%ROWTYPE;
  v_desc text;
  v_unit_price int;
  v_item_type public.service_item_type;
  v_qty numeric := COALESCE(p_quantity, 1);
  v_line_total int;
  v_quote_item_id uuid;
  v_cost int;

  v_quote public.quotes%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_fees_baked boolean := false;
  v_fee_pct numeric;
  v_fee_flat int;

  v_unpaid_count int;
  v_share int;
  v_remainder int;
  v_assigned int;
  v_inv RECORD;
  v_idx int := 0;
  v_share_i int;
  v_new_net int;
  v_new_total int;
  v_new_fee int;
  v_dist jsonb := '[]'::jsonb;
  v_max_seq int;
  v_new_invoice_id uuid;
  v_due_date date;
BEGIN
  IF NOT public.is_studio_user(v_user) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;

  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service item not found'; END IF;
    v_desc := COALESCE(p_custom_description, v_item.name);
    v_unit_price := COALESCE(p_custom_price_cents, v_item.price_cents);
    v_item_type := v_item.item_type;
  ELSE
    IF p_custom_description IS NULL OR p_custom_price_cents IS NULL THEN
      RAISE EXCEPTION 'Custom line requires description and price';
    END IF;
    v_desc := p_custom_description;
    v_unit_price := p_custom_price_cents;
    v_item_type := NULL;
  END IF;

  v_line_total := ROUND(v_unit_price * v_qty)::int;

  INSERT INTO public.quote_items (
    quote_id, service_item_id, description_snapshot, unit_price_cents,
    quantity, line_total_cents, item_type_snapshot, display_order
  ) VALUES (
    p_quote_id, p_service_item_id, v_desc, v_unit_price,
    v_qty, v_line_total, v_item_type, COALESCE(p_display_order, 0)
  ) RETURNING id INTO v_quote_item_id;

  -- Cost + inclusions snapshots (unchanged)
  IF p_service_item_id IS NOT NULL THEN
    SELECT cost_cents INTO v_cost
      FROM public.service_item_costs
      WHERE service_item_id = p_service_item_id;
    INSERT INTO public.quote_item_cost_snapshots (quote_item_id, cost_cents_snapshot)
    VALUES (v_quote_item_id, COALESCE(v_cost, 0));

    INSERT INTO public.quote_item_inclusions (quote_item_id, text, display_order)
    SELECT v_quote_item_id, sii.text, sii.display_order
    FROM public.service_item_inclusions sii
    WHERE sii.service_item_id = p_service_item_id
    ORDER BY sii.display_order, sii.created_at;
  END IF;

  -- ===== POST-BOOKING DISTRIBUTION =====
  -- Only fires when the quote is already accepted (live schedule exists).
  IF v_quote.status::text <> 'accepted' OR v_line_total = 0 THEN
    RETURN v_quote_item_id;
  END IF;

  -- Refresh quote totals server-side so subtotal/total reflect the new line
  -- immediately (client also debounces a write; both produce the same value).
  UPDATE public.quotes q
  SET subtotal_cents = sub.s,
      total_cents = GREATEST(0, sub.s - COALESCE(q.discount_cents, 0)),
      updated_at = now()
  FROM (
    SELECT COALESCE(SUM(line_total_cents), 0)::int AS s
    FROM public.quote_items WHERE quote_id = p_quote_id
  ) sub
  WHERE q.id = p_quote_id;

  SELECT * INTO v_client FROM public.clients WHERE id = v_quote.client_id;
  IF v_client.package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages WHERE id = v_client.package_id;
    v_fees_baked := COALESCE(v_pkg.add_processing_fees, false);
  END IF;

  IF v_fees_baked THEN
    SELECT stripe_percentage, stripe_flat_cents INTO v_fee_pct, v_fee_flat
      FROM public.processing_fee_settings LIMIT 1;
    IF v_fee_pct IS NULL THEN
      RAISE EXCEPTION 'Processing fee settings not configured';
    END IF;
  END IF;

  -- Count unpaid installments (anything not paid / cancelled / refunded / kill_fee)
  SELECT COUNT(*) INTO v_unpaid_count
  FROM public.invoices
  WHERE client_id = v_quote.client_id
    AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested');

  IF v_unpaid_count = 0 THEN
    -- Edge case: every installment already paid → create a new installment
    SELECT COALESCE(MAX(sequence_order), 0) + 1 INTO v_max_seq
      FROM public.invoices WHERE client_id = v_quote.client_id;

    v_new_net := v_line_total;
    IF v_fees_baked THEN
      v_new_total := CEIL((v_new_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
      v_new_fee := v_new_total - v_new_net;
    ELSE
      v_new_total := v_new_net;
      v_new_fee := 0;
    END IF;
    v_due_date := CURRENT_DATE;

    INSERT INTO public.invoices (
      client_id, sequence_order, label, subtotal_cents, processing_fee_cents,
      total_cents, amount, due_date, status, currency, invoice_type
    ) VALUES (
      v_quote.client_id, v_max_seq,
      'Additional charge — ' || v_desc,
      v_new_net, v_new_fee, v_new_total, v_new_total::numeric / 100,
      v_due_date, 'scheduled', 'USD', 'other'::invoice_type
    ) RETURNING id INTO v_new_invoice_id;

    INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
    VALUES (v_new_invoice_id, 'Post-booking addition: ' || v_desc, v_new_net, 1);

    INSERT INTO public.invoice_recipients (invoice_id, name, email, role)
    VALUES (v_new_invoice_id, v_client.couple_name_1, v_client.primary_email, 'primary_client');

    v_dist := jsonb_build_array(jsonb_build_object(
      'invoice_id', v_new_invoice_id, 'created_new', true,
      'net_added_cents', v_new_net, 'total_charged_cents', v_new_total
    ));
  ELSE
    -- Equal-share distribution; remainder to the last unpaid installment.
    v_share := v_line_total / v_unpaid_count;          -- integer cents
    v_remainder := v_line_total - (v_share * v_unpaid_count);
    v_assigned := 0;

    FOR v_inv IN
      SELECT id, subtotal_cents, total_cents, processing_fee_cents, due_date, label
      FROM public.invoices
      WHERE client_id = v_quote.client_id
        AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested')
      ORDER BY due_date NULLS LAST, sequence_order
    LOOP
      v_idx := v_idx + 1;
      IF v_idx = v_unpaid_count THEN
        v_share_i := v_share + v_remainder;
      ELSE
        v_share_i := v_share;
      END IF;
      v_assigned := v_assigned + v_share_i;

      v_new_net := v_inv.subtotal_cents + v_share_i;
      IF v_fees_baked THEN
        v_new_total := CEIL((v_new_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
        v_new_fee := v_new_total - v_new_net;
      ELSE
        v_new_total := v_new_net;
        v_new_fee := 0;
      END IF;

      UPDATE public.invoices
      SET subtotal_cents = v_new_net,
          processing_fee_cents = v_new_fee,
          total_cents = v_new_total,
          amount = v_new_total::numeric / 100,
          updated_at = now()
      WHERE id = v_inv.id;

      INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
      VALUES (
        v_inv.id,
        'Post-booking addition: ' || v_desc || ' (share)',
        v_share_i,
        COALESCE((SELECT MAX(sequence_order) FROM public.invoice_line_items WHERE invoice_id = v_inv.id), 0) + 1
      );

      v_dist := v_dist || jsonb_build_object(
        'invoice_id', v_inv.id,
        'label', v_inv.label,
        'share_cents', v_share_i,
        'new_net_cents', v_new_net,
        'new_total_cents', v_new_total
      );
    END LOOP;

    IF v_assigned <> v_line_total THEN
      RAISE EXCEPTION 'Distribution mismatch: assigned % vs added %', v_assigned, v_line_total;
    END IF;
  END IF;

  PERFORM public._log_activity(
    'quote.item_added_post_booking', 'quote_item', v_quote_item_id,
    'Post-booking add: "' || v_desc || '" ($' || ROUND(v_line_total/100.0, 2)::text ||
      ') distributed across ' || COALESCE(v_unpaid_count, 0) || ' installment(s)',
    v_user,
    jsonb_build_object(
      'client_id', v_quote.client_id,
      'quote_id', p_quote_id,
      'net_added_cents', v_line_total,
      'fees_baked', v_fees_baked,
      'distribution', v_dist
    )
  );

  RETURN v_quote_item_id;
END;
$function$;
