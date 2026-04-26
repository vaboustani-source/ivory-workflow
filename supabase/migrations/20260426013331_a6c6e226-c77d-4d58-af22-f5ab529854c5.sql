-- 1. Add override columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS production_stage_override text,
  ADD COLUMN IF NOT EXISTS production_stage_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_stage_override_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_production_stage_override_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_production_stage_override_check
  CHECK (
    production_stage_override IS NULL OR production_stage_override IN
      ('welcome','planning','engagement','pre_wedding','wedding_week','editing','delivered','album','archive')
  );

-- 2. Calculation function
CREATE OR REPLACE FUNCTION public.calculate_production_stage(_client_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.clients%ROWTYPE;
  has_wedding_gallery boolean;
  eng_scheduled timestamptz;
  eng_delivered timestamptz;
  album_status text;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Override wins
  IF c.production_stage_override IS NOT NULL THEN
    RETURN c.production_stage_override;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.galleries
    WHERE client_id = _client_id
      AND gallery_type = 'wedding'
      AND delivered_at IS NOT NULL
  ) INTO has_wedding_gallery;

  SELECT MIN(scheduled_at), MIN(delivered_at)
    INTO eng_scheduled, eng_delivered
    FROM public.engagement_sessions
    WHERE client_id = _client_id;

  SELECT status::text INTO album_status
    FROM public.albums
    WHERE client_id = _client_id
    ORDER BY COALESCE(ordered_at, '1900-01-01'::timestamptz) DESC
    LIMIT 1;

  -- a. archive
  IF c.status::text = 'archived'
     OR (c.wedding_date IS NOT NULL AND c.wedding_date < (CURRENT_DATE - INTERVAL '18 months')) THEN
    RETURN 'archive';
  END IF;

  -- b. album
  IF COALESCE(c.album_workflow_active,false) = true
     AND (album_status IS NULL OR album_status <> 'delivered') THEN
    RETURN 'album';
  END IF;

  -- c. delivered
  IF has_wedding_gallery THEN
    RETURN 'delivered';
  END IF;

  -- d. editing
  IF c.wedding_date IS NOT NULL AND c.wedding_date < CURRENT_DATE AND NOT has_wedding_gallery THEN
    RETURN 'editing';
  END IF;

  -- e. wedding_week
  IF c.wedding_date IS NOT NULL
     AND c.wedding_date >= CURRENT_DATE
     AND c.wedding_date <= (CURRENT_DATE + INTERVAL '7 days') THEN
    RETURN 'wedding_week';
  END IF;

  -- f. pre_wedding
  IF c.wedding_date IS NOT NULL
     AND c.wedding_date >= CURRENT_DATE
     AND c.wedding_date <= (CURRENT_DATE + INTERVAL '56 days') THEN
    RETURN 'pre_wedding';
  END IF;

  -- g. engagement
  IF COALESCE(c.has_engagement,false) = true
     AND (eng_scheduled IS NULL OR eng_delivered IS NULL)
     AND c.wedding_date IS NOT NULL
     AND c.wedding_date > (CURRENT_DATE + INTERVAL '56 days') THEN
    RETURN 'engagement';
  END IF;

  -- h. planning
  IF c.booked_at IS NOT NULL AND c.booked_at < (now() - INTERVAL '30 days') THEN
    RETURN 'planning';
  END IF;

  -- i. welcome
  RETURN 'welcome';
END;
$$;