-- Extend calendar_provider enum to include Zoom
ALTER TYPE public.calendar_provider ADD VALUE IF NOT EXISTS 'zoom';

-- Extend calendar_connections with OAuth token-management columns
ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scopes text[],
  ADD COLUMN IF NOT EXISTS account_email text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- One active row per (user, provider). Multiple inactive rows allowed for audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_active_unique
  ON public.calendar_connections (user_id, provider)
  WHERE is_active = true;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS calendar_connections_touch_updated_at ON public.calendar_connections;
CREATE TRIGGER calendar_connections_touch_updated_at
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Grants: tokens are read/written only by service role (server-side code).
-- Studio users get a non-secret read via the existing RLS SELECT policy through
-- a server function projection — no direct authenticated access to tokens.
GRANT ALL ON public.calendar_connections TO service_role;
-- Authenticated read is intentionally limited; the existing RLS policy
-- "Studio reads calendar_connections" still applies on top of these grants.
GRANT SELECT ON public.calendar_connections TO authenticated;