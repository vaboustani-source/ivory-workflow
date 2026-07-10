
CREATE OR REPLACE FUNCTION public.record_manual_payment(
  p_invoice_id uuid,
  p_amount_cents integer,
  p_paid_on date,
  p_method text,
  p_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_notes text;
  v_new_note text;
  v_method_label text;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;

  v_method_label := COALESCE(NULLIF(p_method, ''), 'manual');

  v_new_note := 'Manual payment recorded: ' || v_method_label || ' on ' || to_char(p_paid_on, 'YYYY-MM-DD');
  IF p_note IS NOT NULL AND length(btrim(p_note)) > 0 THEN
    v_new_note := v_new_note || ' – ' || btrim(p_note);
  END IF;

  SELECT notes INTO v_existing_notes FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  UPDATE public.invoices
     SET status = 'paid',
         paid_at = (p_paid_on::timestamptz),
         notes = CASE
           WHEN v_existing_notes IS NULL OR length(btrim(v_existing_notes)) = 0 THEN v_new_note
           ELSE v_existing_notes || E'\n' || v_new_note
         END,
         updated_at = now()
   WHERE id = p_invoice_id;

  INSERT INTO public.payment_attempts (
    invoice_id, amount_cents, status, stripe_event_type, raw_event
  ) VALUES (
    p_invoice_id,
    p_amount_cents,
    'paid',
    'manual',
    jsonb_build_object(
      'method', v_method_label,
      'note', p_note,
      'paid_on', to_char(p_paid_on, 'YYYY-MM-DD'),
      'recorded_by', auth.uid()
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_manual_payment(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_attempts
    WHERE invoice_id = p_invoice_id AND stripe_event_type = 'manual'
  ) THEN
    RAISE EXCEPTION 'no manual payment to undo';
  END IF;

  UPDATE public.invoices
     SET status = 'scheduled',
         paid_at = NULL,
         updated_at = now()
   WHERE id = p_invoice_id;

  DELETE FROM public.payment_attempts
   WHERE invoice_id = p_invoice_id AND stripe_event_type = 'manual';
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_payment(uuid, integer, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_manual_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_manual_payment(uuid, integer, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_manual_payment(uuid) TO authenticated;
