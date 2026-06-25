
-- Queue bookkeeping columns
ALTER TABLE public.scheduled_communications
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Master gate
ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS scheduled_emails_enabled boolean NOT NULL DEFAULT false;

-- Helpful index for the DUE selector
CREATE INDEX IF NOT EXISTS idx_scheduled_comms_due
  ON public.scheduled_communications (scheduled_send_at)
  WHERE status = 'approved';

-- Atomic claim function: locks DUE rows with SKIP LOCKED so concurrent
-- processor ticks never pick the same row twice.
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_communications(p_limit integer DEFAULT 50)
RETURNS SETOF public.scheduled_communications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.scheduled_communications
    WHERE status = 'approved'
      AND scheduled_send_at IS NOT NULL
      AND scheduled_send_at <= now()
    ORDER BY scheduled_send_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_communications sc
     SET attempt_count = sc.attempt_count + 1
    FROM due
   WHERE sc.id = due.id
  RETURNING sc.*;
END;
$$;

-- Only service_role (used by supabaseAdmin) may call it. Revoke from public.
REVOKE ALL ON FUNCTION public.claim_due_scheduled_communications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_communications(integer) TO service_role;
