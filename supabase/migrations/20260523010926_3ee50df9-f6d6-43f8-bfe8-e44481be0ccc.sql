CREATE OR REPLACE FUNCTION public.add_quote_item(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric DEFAULT 1,
  p_custom_description text DEFAULT NULL,
  p_custom_price_cents int DEFAULT NULL,
  p_display_order int DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF NOT public.is_studio_user(v_user) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = p_quote_id) THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Service item not found';
    END IF;
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

  -- Capture cost snapshot server-side so managers don't have to read costs
  IF p_service_item_id IS NOT NULL THEN
    SELECT cost_cents INTO v_cost
      FROM public.service_item_costs
      WHERE service_item_id = p_service_item_id;
    INSERT INTO public.quote_item_cost_snapshots (quote_item_id, cost_cents_snapshot)
    VALUES (v_quote_item_id, COALESCE(v_cost, 0));
  END IF;

  RETURN v_quote_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_quote_item(uuid, uuid, numeric, text, int, int) TO authenticated;