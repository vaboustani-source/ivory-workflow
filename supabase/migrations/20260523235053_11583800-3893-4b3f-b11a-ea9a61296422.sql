
CREATE OR REPLACE FUNCTION public._b3_test_add(
  p_quote_id uuid, p_desc text, p_price_cents int, p_owner uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_client_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_new_item uuid;
  v_total_before int;
  v_total_after int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_owner::text, 'role','authenticated')::text, true);
  SELECT client_id, total_cents INTO v_client_id, v_total_before FROM public.quotes WHERE id = p_quote_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'subtotal_cents', subtotal_cents,
    'processing_fee_cents', processing_fee_cents, 'total_cents', total_cents,
    'status', status
  ) ORDER BY due_date, sequence_order)
  INTO v_before
  FROM public.invoices WHERE client_id = v_client_id;

  v_new_item := public.add_quote_item(p_quote_id, NULL, 1, p_desc, p_price_cents, 999);

  SELECT total_cents INTO v_total_after FROM public.quotes WHERE id = p_quote_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'subtotal_cents', subtotal_cents,
    'processing_fee_cents', processing_fee_cents, 'total_cents', total_cents,
    'status', status
  ) ORDER BY due_date, sequence_order)
  INTO v_after
  FROM public.invoices WHERE client_id = v_client_id;

  RETURN jsonb_build_object(
    'new_quote_item_id', v_new_item,
    'quote_total_before_cents', v_total_before,
    'quote_total_after_cents', v_total_after,
    'schedule_net_sum_after',
       (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices
        WHERE client_id = v_client_id
          AND status::text NOT IN ('cancelled','refunded','kill_fee')),
    'schedule_total_sum_after',
       (SELECT COALESCE(SUM(total_cents),0) FROM public.invoices
        WHERE client_id = v_client_id
          AND status::text NOT IN ('cancelled','refunded','kill_fee')),
    'invoices_before', v_before,
    'invoices_after', v_after
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public._b3_test_add(uuid,text,int,uuid) FROM PUBLIC, anon, authenticated;
