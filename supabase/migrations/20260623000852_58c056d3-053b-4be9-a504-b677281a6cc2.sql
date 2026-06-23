ALTER TABLE public.calendar_connections DROP CONSTRAINT calendar_connections_user_id_key;
CREATE UNIQUE INDEX calendar_connections_user_provider_active_uniq
  ON public.calendar_connections (user_id, provider)
  WHERE is_active = true;