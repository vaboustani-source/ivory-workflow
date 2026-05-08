
-- Wedding expenses table
CREATE TABLE IF NOT EXISTS public.wedding_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text DEFAULT 'other',
  amount numeric(10,2) NOT NULL,
  expense_date date DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wedding_expenses_client ON public.wedding_expenses(client_id);

ALTER TABLE public.wedding_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio can read wedding_expenses" ON public.wedding_expenses;
CREATE POLICY "Studio can read wedding_expenses" ON public.wedding_expenses
  FOR SELECT USING (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "Studio can insert wedding_expenses" ON public.wedding_expenses;
CREATE POLICY "Studio can insert wedding_expenses" ON public.wedding_expenses
  FOR INSERT WITH CHECK (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "Studio can update wedding_expenses" ON public.wedding_expenses;
CREATE POLICY "Studio can update wedding_expenses" ON public.wedding_expenses
  FOR UPDATE USING (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "Studio can delete wedding_expenses" ON public.wedding_expenses;
CREATE POLICY "Studio can delete wedding_expenses" ON public.wedding_expenses
  FOR DELETE USING (public.is_studio_user(auth.uid()));

-- Editing cost tracking on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS final_image_count int,
  ADD COLUMN IF NOT EXISTS editing_rate_per_image numeric(6,3) DEFAULT 0.05;

COMMENT ON COLUMN public.clients.final_image_count IS 'Final delivered image count, used to calculate editing cost';
COMMENT ON COLUMN public.clients.editing_rate_per_image IS 'Per-image editing cost (default 0.05)';

-- Default editing rate on studio_settings
ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS default_editing_rate numeric(6,3) DEFAULT 0.05;

-- Trigger to copy default editing rate from active studio_settings to new clients
CREATE OR REPLACE FUNCTION public._trg_clients_default_editing_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rate numeric(6,3);
BEGIN
  IF NEW.editing_rate_per_image IS NULL THEN
    SELECT default_editing_rate INTO v_rate FROM public.studio_settings WHERE is_active = true LIMIT 1;
    NEW.editing_rate_per_image := COALESCE(v_rate, 0.05);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_default_editing_rate ON public.clients;
CREATE TRIGGER trg_clients_default_editing_rate
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_default_editing_rate();
