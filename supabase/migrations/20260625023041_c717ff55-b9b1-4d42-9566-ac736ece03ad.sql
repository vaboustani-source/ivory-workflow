
ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS invoice_reminders_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.scheduled_communications
  ADD COLUMN IF NOT EXISTS invoice_id uuid NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reminder_kind text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_comm_invoice_reminder_uniq
  ON public.scheduled_communications (invoice_id, reminder_kind)
  WHERE reminder_kind IS NOT NULL;
