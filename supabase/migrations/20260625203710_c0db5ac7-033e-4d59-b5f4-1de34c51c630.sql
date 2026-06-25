ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS titled_calendar_ids text[] NOT NULL DEFAULT '{}';

-- Backfill: preserve existing behavior. The professional connection (used by
-- the dashboard for titled events) should default titled = busy so the prior
-- titled rendering keeps working. Personal connections stay untitled.
UPDATE public.calendar_connections cc
SET titled_calendar_ids = COALESCE(cc.busy_calendar_ids, ARRAY['primary']::text[])
WHERE cc.id = (
  SELECT booking_calendar_connection_id
  FROM public.scheduling_settings
  WHERE booking_calendar_connection_id IS NOT NULL
  LIMIT 1
)
AND (cc.titled_calendar_ids IS NULL OR array_length(cc.titled_calendar_ids, 1) IS NULL);