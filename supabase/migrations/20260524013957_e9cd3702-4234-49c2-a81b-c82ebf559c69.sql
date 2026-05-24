
-- Overhead cadence enum
DO $$ BEGIN
  CREATE TYPE public.studio_overhead_cadence AS ENUM ('monthly','annual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Overhead line items
CREATE TABLE IF NOT EXISTS public.studio_overhead_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  category text,
  amount_cents integer NOT NULL,
  cadence public.studio_overhead_cadence NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_overhead_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read overhead" ON public.studio_overhead_items
  FOR SELECT USING (public.is_owner(auth.uid()));
CREATE POLICY "Owner can insert overhead" ON public.studio_overhead_items
  FOR INSERT WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Owner can update overhead" ON public.studio_overhead_items
  FOR UPDATE USING (public.is_owner(auth.uid()));
CREATE POLICY "Owner can delete overhead" ON public.studio_overhead_items
  FOR DELETE USING (public.is_owner(auth.uid()));

CREATE TRIGGER trg_studio_overhead_items_updated_at
  BEFORE UPDATE ON public.studio_overhead_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Expected weddings per year
ALTER TABLE public.studio_cost_settings
  ADD COLUMN IF NOT EXISTS expected_weddings_per_year integer DEFAULT 25;
