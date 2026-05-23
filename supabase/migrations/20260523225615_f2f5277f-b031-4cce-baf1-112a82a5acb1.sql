
-- Catalog default inclusion bullets
CREATE TABLE public.service_item_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid NOT NULL REFERENCES public.service_items(id) ON DELETE CASCADE,
  text text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_item_inclusions_item ON public.service_item_inclusions(service_item_id, display_order);

ALTER TABLE public.service_item_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio can read inclusions"
  ON public.service_item_inclusions FOR SELECT
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Clients can read inclusions of active items"
  ON public.service_item_inclusions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.service_items si
      WHERE si.id = service_item_inclusions.service_item_id
        AND si.is_active = true
    )
  );

CREATE POLICY "Owner can insert inclusions"
  ON public.service_item_inclusions FOR INSERT
  WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner can update inclusions"
  ON public.service_item_inclusions FOR UPDATE
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner can delete inclusions"
  ON public.service_item_inclusions FOR DELETE
  USING (public.is_owner(auth.uid()));


-- Per-quote-line inclusion snapshot
CREATE TABLE public.quote_item_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_id uuid NOT NULL REFERENCES public.quote_items(id) ON DELETE CASCADE,
  text text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quote_item_inclusions_item ON public.quote_item_inclusions(quote_item_id, display_order);

ALTER TABLE public.quote_item_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio can read quote inclusions"
  ON public.quote_item_inclusions FOR SELECT
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Client can read own quote inclusions"
  ON public.quote_item_inclusions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quote_items qi
      JOIN public.quotes q ON q.id = qi.quote_id
      WHERE qi.id = quote_item_inclusions.quote_item_id
        AND public.is_client_of(auth.uid(), q.client_id)
    )
  );

-- TODO: approval workflow will gate manager edits later (same as quote_items).
CREATE POLICY "Studio can insert quote inclusions"
  ON public.quote_item_inclusions FOR INSERT
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio can update quote inclusions"
  ON public.quote_item_inclusions FOR UPDATE
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio can delete quote inclusions"
  ON public.quote_item_inclusions FOR DELETE
  USING (public.is_studio_user(auth.uid()));


-- Update add_quote_item to snapshot catalog inclusions into the new line
CREATE OR REPLACE FUNCTION public.add_quote_item(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric DEFAULT 1,
  p_custom_description text DEFAULT NULL::text,
  p_custom_price_cents integer DEFAULT NULL::integer,
  p_display_order integer DEFAULT 0
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- Snapshot catalog inclusion bullets into this new quote line
    INSERT INTO public.quote_item_inclusions (quote_item_id, text, display_order)
    SELECT v_quote_item_id, sii.text, sii.display_order
    FROM public.service_item_inclusions sii
    WHERE sii.service_item_id = p_service_item_id
    ORDER BY sii.display_order, sii.created_at;
  END IF;

  RETURN v_quote_item_id;
END;
$function$;
