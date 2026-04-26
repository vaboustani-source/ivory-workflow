ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS venue_street text,
  ADD COLUMN IF NOT EXISTS venue_city text,
  ADD COLUMN IF NOT EXISTS venue_state text,
  ADD COLUMN IF NOT EXISTS venue_postal_code text;