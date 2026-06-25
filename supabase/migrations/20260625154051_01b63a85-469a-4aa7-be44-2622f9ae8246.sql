
ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS busy_calendar_ids text[] NOT NULL DEFAULT ARRAY['primary']::text[];

DROP INDEX IF EXISTS public.calendar_connections_user_provider_active_uniq;
DROP INDEX IF EXISTS public.calendar_connections_active_unique;

CREATE UNIQUE INDEX calendar_connections_google_active_uniq
  ON public.calendar_connections (user_id, provider, account_email)
  WHERE is_active = true AND provider = 'google';

CREATE UNIQUE INDEX calendar_connections_zoom_active_uniq
  ON public.calendar_connections (user_id, provider)
  WHERE is_active = true AND provider = 'zoom';

ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS booking_calendar_connection_id uuid REFERENCES public.calendar_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_calendar_id text;
