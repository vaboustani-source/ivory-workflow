
-- create_tbd_booking
CREATE OR REPLACE FUNCTION public.create_tbd_booking(
  p_client_id uuid,
  p_deposit_amount_cents integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_settings public.studio_invoicing_settings%ROWTYPE;
  v_finalize_by date;
  v_invoice_id uuid;
  v_wd_label text;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF v_client.wedding_date IS NULL THEN
    RAISE EXCEPTION 'Set a wedding date before creating a date hold.';
  END IF;
  IF p_deposit_amount_cents IS NULL OR p_deposit_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be greater than zero';
  END IF;
  SELECT * INTO v_settings FROM public.studio_invoicing_settings LIMIT 1;
  v_finalize_by := CURRENT_DATE + COALESCE(v_settings.tbd_finalize_window_days, 7);
  v_wd_label := to_char(v_client.wedding_date, 'FMMon FMDD, YYYY');

  INSERT INTO public.invoices (
    client_id, sequence_order, label, subtotal_cents, processing_fee_cents,
    total_cents, amount, due_date, status, currency, invoice_type
  ) VALUES (
    p_client_id, 0, 'Date-hold deposit', p_deposit_amount_cents, 0,
    p_deposit_amount_cents, (p_deposit_amount_cents::numeric / 100), CURRENT_DATE,
    'scheduled', 'usd', 'date_hold_deposit'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
  VALUES (v_invoice_id, 'Date-hold deposit — wedding on ' || v_wd_label, p_deposit_amount_cents, 0);

  INSERT INTO public.invoice_recipients (invoice_id, name, email, role)
  VALUES (v_invoice_id,
    v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2, ''),
    v_client.primary_email, 'primary_client');

  UPDATE public.clients
    SET status = 'booked',
        is_tbd_booking = true,
        tbd_booked_at = now(),
        tbd_finalize_by = v_finalize_by,
        tbd_deposit_amount_cents = p_deposit_amount_cents,
        tbd_deposit_invoice_id = v_invoice_id,
        tbd_cancelled_at = NULL,
        tbd_cancellation_reason = NULL,
        booked_at = now()
    WHERE id = p_client_id;

  PERFORM public._log_activity('invoice.created','invoice',v_invoice_id,
    'Date-hold deposit invoice created', auth.uid(),
    jsonb_build_object('client_id', p_client_id, 'amount_cents', p_deposit_amount_cents));
  PERFORM public._log_activity('booking.tbd_created','client',p_client_id,
    'Date-hold booking created. Finalize by ' || v_finalize_by::text, auth.uid(),
    jsonb_build_object('deposit_amount_cents', p_deposit_amount_cents,
      'finalize_by', v_finalize_by, 'invoice_id', v_invoice_id));

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'finalize_by', v_finalize_by);
END;
$$;

-- finalize_tbd_booking
CREATE OR REPLACE FUNCTION public.finalize_tbd_booking(
  p_client_id uuid,
  p_template_id uuid,
  p_package_id uuid,
  p_overrides jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_deposit int;
  v_remaining int;
  v_inv_ids uuid[] := '{}';
  v_first_inv_id uuid;
  v_result jsonb;
  v_apply int;
  v_inv RECORD;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT v_client.is_tbd_booking THEN
    RAISE EXCEPTION 'Client is not a TBD booking';
  END IF;

  -- Set the package on the client BEFORE generating invoices
  UPDATE public.clients SET package_id = p_package_id WHERE id = p_client_id;

  -- Generate the schedule
  v_result := public.create_booking_invoices(p_client_id, p_template_id, p_overrides);

  v_deposit := COALESCE(v_client.tbd_deposit_amount_cents, 0);
  v_remaining := v_deposit;

  -- Apply credit across invoices in order (sequence_order >= 1)
  FOR v_inv IN
    SELECT * FROM public.invoices
    WHERE client_id = p_client_id AND sequence_order >= 1
    ORDER BY sequence_order
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_inv.total_cents);
    IF v_apply > 0 THEN
      INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
      VALUES (v_inv.id, 'Date-hold deposit applied', -v_apply,
        COALESCE((SELECT MAX(sequence_order) + 1 FROM public.invoice_line_items WHERE invoice_id = v_inv.id), 1));
      UPDATE public.invoices
        SET total_cents = total_cents - v_apply,
            amount = (total_cents - v_apply)::numeric / 100
        WHERE id = v_inv.id;
      v_remaining := v_remaining - v_apply;
    END IF;
  END LOOP;

  UPDATE public.clients
    SET is_tbd_booking = false,
        tbd_finalize_by = NULL
    WHERE id = p_client_id;

  PERFORM public._log_activity('booking.finalized','client',p_client_id,
    'Date-hold booking finalized. Deposit of ' || (v_deposit::numeric / 100)::text || ' credited.',
    auth.uid(),
    jsonb_build_object('deposit_credited_cents', v_deposit - v_remaining,
      'deposit_remaining_cents', v_remaining,
      'package_id', p_package_id, 'template_id', p_template_id));

  RETURN v_result || jsonb_build_object('deposit_credited_cents', v_deposit - v_remaining,
    'deposit_remaining_cents', v_remaining);
END;
$$;

-- cancel_tbd_booking
CREATE OR REPLACE FUNCTION public.cancel_tbd_booking(
  p_client_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client public.clients%ROWTYPE;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF NOT v_client.is_tbd_booking THEN
    RAISE EXCEPTION 'Client is not a TBD booking';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Cancellation reason required';
  END IF;

  IF v_client.tbd_deposit_invoice_id IS NOT NULL THEN
    UPDATE public.invoices
      SET invoice_type = 'kill_fee',
          label = 'Kill fee (cancelled date hold)'
      WHERE id = v_client.tbd_deposit_invoice_id;
  END IF;

  UPDATE public.clients
    SET status = 'lead',
        is_tbd_booking = false,
        tbd_cancelled_at = now(),
        tbd_cancellation_reason = p_reason,
        booked_at = NULL
    WHERE id = p_client_id;

  PERFORM public._log_activity('booking.tbd_cancelled','client',p_client_id,
    'Date-hold cancelled. Deposit retained as kill fee. Reason: ' || p_reason,
    auth.uid(),
    jsonb_build_object('deposit_amount_cents', v_client.tbd_deposit_amount_cents,
      'reason', p_reason));

  RETURN jsonb_build_object('success', true,
    'deposit_amount_cents', v_client.tbd_deposit_amount_cents);
END;
$$;
