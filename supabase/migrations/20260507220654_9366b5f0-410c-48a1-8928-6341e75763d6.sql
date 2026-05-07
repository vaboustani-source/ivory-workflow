ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS studio_address text,
  ADD COLUMN IF NOT EXISTS studio_mailing_address text,
  ADD COLUMN IF NOT EXISTS ein text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN public.studio_settings.studio_address IS 'Physical business address (used in contracts, marketing materials)';
COMMENT ON COLUMN public.studio_settings.studio_mailing_address IS 'Mailing address if different from physical (PO box, etc.)';
COMMENT ON COLUMN public.studio_settings.ein IS 'Tax ID / Employer Identification Number';
COMMENT ON COLUMN public.studio_settings.instagram IS 'Instagram handle (with or without @)';
COMMENT ON COLUMN public.studio_settings.website IS 'Studio public website URL';