CREATE TABLE IF NOT EXISTS public.studio_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean DEFAULT true,
  photographer_name text,
  photographer_company text DEFAULT 'Stories by Victoria',
  studio_email text,
  studio_phone text,
  overage_hourly_rate int,
  video_cancellation_fee int,
  album_credit_expiry_months int DEFAULT 8,
  rescheduling_fee_pct int DEFAULT 25,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.studio_settings (
  is_active, photographer_name, photographer_company,
  overage_hourly_rate, video_cancellation_fee,
  album_credit_expiry_months, rescheduling_fee_pct
)
SELECT true, 'Victoria Boustani', 'Stories by Victoria', 700, 1500, 8, 25
WHERE NOT EXISTS (SELECT 1 FROM public.studio_settings);

CREATE INDEX IF NOT EXISTS idx_studio_settings_active 
  ON public.studio_settings(is_active) 
  WHERE is_active = true;

ALTER TABLE public.studio_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio can read settings" ON public.studio_settings
  FOR SELECT TO authenticated
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner can update settings" ON public.studio_settings
  FOR UPDATE TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

CREATE TRIGGER trg_studio_settings_updated_at
  BEFORE UPDATE ON public.studio_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();