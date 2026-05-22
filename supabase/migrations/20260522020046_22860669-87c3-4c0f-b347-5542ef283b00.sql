-- ============ ENUMS ============
CREATE TYPE public.service_item_type AS ENUM (
  'wedding_package','engagement_session','portrait_session','album',
  'videography','print','add_on','deliverable','travel','custom'
);

CREATE TYPE public.service_item_unit AS ENUM (
  'flat','per_hour','per_mile','per_person','per_unit'
);

-- ============ service_items ============
CREATE TABLE public.service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  item_type public.service_item_type NOT NULL,
  price_cents int NOT NULL DEFAULT 0,
  unit public.service_item_unit NOT NULL DEFAULT 'flat',
  coverage_hours numeric,
  is_active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  is_taxable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER service_items_set_updated_at
BEFORE UPDATE ON public.service_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Studio reads service_items"
ON public.service_items FOR SELECT TO authenticated
USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Clients read active service_items"
ON public.service_items FOR SELECT TO authenticated
USING (is_active = true);

CREATE POLICY "Owner inserts service_items"
ON public.service_items FOR INSERT TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates service_items"
ON public.service_items FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner deletes service_items"
ON public.service_items FOR DELETE TO authenticated
USING (public.is_owner(auth.uid()));

-- ============ service_item_costs (OWNER-ONLY wall) ============
CREATE TABLE public.service_item_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid NOT NULL UNIQUE REFERENCES public.service_items(id) ON DELETE CASCADE,
  cost_cents int NOT NULL DEFAULT 0,
  cost_type public.service_item_unit NOT NULL DEFAULT 'flat',
  estimated_labor_hours numeric,
  cost_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_item_costs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER service_item_costs_set_updated_at
BEFORE UPDATE ON public.service_item_costs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Owner reads service_item_costs"
ON public.service_item_costs FOR SELECT TO authenticated
USING (public.is_owner(auth.uid()));

CREATE POLICY "Owner inserts service_item_costs"
ON public.service_item_costs FOR INSERT TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates service_item_costs"
ON public.service_item_costs FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner deletes service_item_costs"
ON public.service_item_costs FOR DELETE TO authenticated
USING (public.is_owner(auth.uid()));

-- ============ package_default_inclusions ============
CREATE TABLE public.package_default_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_item_id uuid NOT NULL REFERENCES public.service_items(id) ON DELETE CASCADE,
  included_item_id uuid NOT NULL REFERENCES public.service_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_item_id, included_item_id)
);
ALTER TABLE public.package_default_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads package_default_inclusions"
ON public.package_default_inclusions FOR SELECT TO authenticated
USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner inserts package_default_inclusions"
ON public.package_default_inclusions FOR INSERT TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates package_default_inclusions"
ON public.package_default_inclusions FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner deletes package_default_inclusions"
ON public.package_default_inclusions FOR DELETE TO authenticated
USING (public.is_owner(auth.uid()));

-- ============ studio_cost_settings (OWNER-ONLY wall) ============
CREATE TABLE public.studio_cost_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_cost_per_hour_cents int,
  travel_cost_per_mile_cents int,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.studio_cost_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER studio_cost_settings_set_updated_at
BEFORE UPDATE ON public.studio_cost_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Owner reads studio_cost_settings"
ON public.studio_cost_settings FOR SELECT TO authenticated
USING (public.is_owner(auth.uid()));

CREATE POLICY "Owner inserts studio_cost_settings"
ON public.studio_cost_settings FOR INSERT TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates studio_cost_settings"
ON public.studio_cost_settings FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner deletes studio_cost_settings"
ON public.studio_cost_settings FOR DELETE TO authenticated
USING (public.is_owner(auth.uid()));

INSERT INTO public.studio_cost_settings DEFAULT VALUES;

-- ============ studio_invoicing_settings columns ============
ALTER TABLE public.studio_invoicing_settings
  ADD COLUMN IF NOT EXISTS hourly_coverage_rate_cents int,
  ADD COLUMN IF NOT EXISTS annual_rate_escalation_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proposal_validity_days int NOT NULL DEFAULT 30;