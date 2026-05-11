
-- 1. Enum additions
ALTER TYPE public.invoice_type ADD VALUE IF NOT EXISTS 'installment';
ALTER TYPE public.invoice_type ADD VALUE IF NOT EXISTS 'date_hold_deposit';
ALTER TYPE public.invoice_type ADD VALUE IF NOT EXISTS 'kill_fee';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'kill_fee';

-- 2. Client TBD columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_tbd_booking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tbd_booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS tbd_finalize_by date,
  ADD COLUMN IF NOT EXISTS tbd_deposit_amount_cents integer,
  ADD COLUMN IF NOT EXISTS tbd_deposit_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tbd_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS tbd_cancellation_reason text;

-- 3. studio_invoicing_settings
CREATE TABLE IF NOT EXISTS public.studio_invoicing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tbd_deposit_amount_cents integer NOT NULL DEFAULT 200000,
  tbd_finalize_window_days integer NOT NULL DEFAULT 7,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.studio_invoicing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "studio all sis" ON public.studio_invoicing_settings;
CREATE POLICY "studio all sis" ON public.studio_invoicing_settings
  FOR ALL USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));
INSERT INTO public.studio_invoicing_settings (tbd_deposit_amount_cents, tbd_finalize_window_days)
SELECT 200000, 7
WHERE NOT EXISTS (SELECT 1 FROM public.studio_invoicing_settings);
