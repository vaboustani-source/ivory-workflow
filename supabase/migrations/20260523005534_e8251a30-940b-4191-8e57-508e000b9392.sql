-- Enum
CREATE TYPE public.quote_status AS ENUM ('draft', 'sent', 'accepted', 'expired');

-- quotes
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  status public.quote_status NOT NULL DEFAULT 'draft',
  subtotal_cents int NOT NULL DEFAULT 0,
  discount_cents int NOT NULL DEFAULT 0,
  total_cents int NOT NULL DEFAULT 0,
  escalation_pct_applied numeric NOT NULL DEFAULT 0,
  valid_until date,
  notes text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_quotes_updated_at
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quotes_select_studio_or_client" ON public.quotes
FOR SELECT TO authenticated
USING (public.is_studio_user(auth.uid()) OR public.is_client_of(auth.uid(), client_id));

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quotes_insert_studio" ON public.quotes
FOR INSERT TO authenticated
WITH CHECK (public.is_studio_user(auth.uid()));

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quotes_update_studio" ON public.quotes
FOR UPDATE TO authenticated
USING (public.is_studio_user(auth.uid()))
WITH CHECK (public.is_studio_user(auth.uid()));

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quotes_delete_studio" ON public.quotes
FOR DELETE TO authenticated
USING (public.is_studio_user(auth.uid()));

-- quote_items
CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service_item_id uuid REFERENCES public.service_items(id) ON DELETE SET NULL,
  description_snapshot text NOT NULL,
  unit_price_cents int NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  line_total_cents int NOT NULL,
  item_type_snapshot public.service_item_type,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_quote_items_quote_id ON public.quote_items(quote_id);

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quote_items_select_studio_or_client" ON public.quote_items
FOR SELECT TO authenticated
USING (
  public.is_studio_user(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_items.quote_id
      AND public.is_client_of(auth.uid(), q.client_id)
  )
);

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quote_items_insert_studio" ON public.quote_items
FOR INSERT TO authenticated
WITH CHECK (public.is_studio_user(auth.uid()));

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quote_items_update_studio" ON public.quote_items
FOR UPDATE TO authenticated
USING (public.is_studio_user(auth.uid()))
WITH CHECK (public.is_studio_user(auth.uid()));

-- TODO: approval workflow will restrict manager direct-edits to pricing — see pending_changes step.
CREATE POLICY "quote_items_delete_studio" ON public.quote_items
FOR DELETE TO authenticated
USING (public.is_studio_user(auth.uid()));

-- quote_item_cost_snapshots (OWNER ONLY)
CREATE TABLE public.quote_item_cost_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_id uuid NOT NULL UNIQUE REFERENCES public.quote_items(id) ON DELETE CASCADE,
  cost_cents_snapshot int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_item_cost_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_item_cost_snapshots_select_owner" ON public.quote_item_cost_snapshots
FOR SELECT TO authenticated
USING (public.is_owner(auth.uid()));

CREATE POLICY "quote_item_cost_snapshots_insert_owner" ON public.quote_item_cost_snapshots
FOR INSERT TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "quote_item_cost_snapshots_update_owner" ON public.quote_item_cost_snapshots
FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "quote_item_cost_snapshots_delete_owner" ON public.quote_item_cost_snapshots
FOR DELETE TO authenticated
USING (public.is_owner(auth.uid()));