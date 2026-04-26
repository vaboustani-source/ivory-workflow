-- Storage cleanup queue
CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_queue_status_scheduled
  ON public.storage_cleanup_queue(status, scheduled_at);

ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages cleanup queue"
  ON public.storage_cleanup_queue
  FOR ALL
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- Trigger: when a client is archived, queue cleanup in 30 days
CREATE OR REPLACE FUNCTION public.archive_client_attachments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'archived' AND (OLD.status IS DISTINCT FROM 'archived') THEN
    INSERT INTO public.storage_cleanup_queue (target_type, target_id, scheduled_at, reason)
    VALUES ('client_archive', NEW.id, now() + interval '30 days', 'Client archived');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_client_attachments ON public.clients;
CREATE TRIGGER trg_archive_client_attachments
  AFTER UPDATE OF status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_client_attachments();

-- Hard delete messages soft-deleted more than 30 days ago
CREATE OR REPLACE FUNCTION public.hard_delete_old_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.messages
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;

-- Enable extensions for cron + http
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Daily hard-delete job at 03:00 UTC
SELECT cron.unschedule('hard-delete-old-messages') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hard-delete-old-messages');
SELECT cron.schedule(
  'hard-delete-old-messages',
  '0 3 * * *',
  $$ SELECT public.hard_delete_old_messages(); $$
);
