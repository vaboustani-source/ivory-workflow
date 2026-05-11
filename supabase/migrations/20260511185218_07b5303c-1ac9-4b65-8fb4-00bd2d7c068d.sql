
-- Extend invoice_status enum
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'viewed';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'reschedule_requested';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'refunded';

-- New enums
DO $$ BEGIN
  CREATE TYPE public.due_offset_type AS ENUM ('days_after_booking','days_before_event','on_booking');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_recipient_role AS ENUM ('primary_client','partner','planner','parent','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_attempt_status AS ENUM ('succeeded','failed','refunded','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reschedule_requested_by AS ENUM ('client','studio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reschedule_status AS ENUM ('pending','approved','denied','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sequence_order int,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS subtotal_cents int,
  ADD COLUMN IF NOT EXISTS processing_fee_cents int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents int,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS payment_method_last4 text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS add_processing_fees boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_payment_schedule_template_id uuid;

-- payment_schedule_templates
CREATE TABLE IF NOT EXISTS public.payment_schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pst_updated_at BEFORE UPDATE ON public.payment_schedule_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.packages
  ADD CONSTRAINT packages_default_pst_fk
  FOREIGN KEY (default_payment_schedule_template_id)
  REFERENCES public.payment_schedule_templates(id) ON DELETE SET NULL;

-- payment_schedule_template_installments
CREATE TABLE IF NOT EXISTS public.payment_schedule_template_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.payment_schedule_templates(id) ON DELETE CASCADE,
  sequence_order int NOT NULL,
  label text NOT NULL,
  percentage numeric(6,3) NOT NULL,
  due_offset_type public.due_offset_type NOT NULL,
  due_offset_days int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pst_installments_template ON public.payment_schedule_template_installments(template_id, sequence_order);

-- invoice_line_items
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount_cents int NOT NULL,
  sequence_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON public.invoice_line_items(invoice_id, sequence_order);

-- invoice_recipients
CREATE TABLE IF NOT EXISTS public.invoice_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  role public.invoice_recipient_role NOT NULL DEFAULT 'primary_client',
  view_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_recipients_invoice ON public.invoice_recipients(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_recipients_token ON public.invoice_recipients(view_token);

-- payment_attempts
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  status public.payment_attempt_status NOT NULL,
  stripe_event_id text UNIQUE,
  stripe_event_type text,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON public.payment_attempts(invoice_id);

-- reschedule_requests
CREATE TABLE IF NOT EXISTS public.reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  requested_by public.reschedule_requested_by NOT NULL,
  requested_by_name text,
  original_due_date date NOT NULL,
  proposed_due_date date NOT NULL,
  reason text,
  status public.reschedule_status NOT NULL DEFAULT 'pending',
  conversation_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  responded_at timestamptz,
  responded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reschedule_invoice ON public.reschedule_requests(invoice_id);
CREATE INDEX IF NOT EXISTS idx_reschedule_status ON public.reschedule_requests(status);

-- processing_fee_settings (single-row)
CREATE TABLE IF NOT EXISTS public.processing_fee_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_percentage numeric(5,3) NOT NULL DEFAULT 2.9,
  stripe_flat_cents int NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pfs_updated_at BEFORE UPDATE ON public.processing_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.processing_fee_settings (stripe_percentage, stripe_flat_cents)
SELECT 2.9, 30 WHERE NOT EXISTS (SELECT 1 FROM public.processing_fee_settings);

-- ============== RLS ==============

ALTER TABLE public.payment_schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_schedule_template_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reschedule_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_fee_settings ENABLE ROW LEVEL SECURITY;

-- Studio-wide full access policies
CREATE POLICY "studio all pst" ON public.payment_schedule_templates
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all psti" ON public.payment_schedule_template_installments
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all line_items" ON public.invoice_line_items
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all recipients" ON public.invoice_recipients
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all payment_attempts" ON public.payment_attempts
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all reschedule" ON public.reschedule_requests
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "studio all pfs" ON public.processing_fee_settings
  FOR ALL TO authenticated
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

-- Clients can read their own line items + recipients (via invoice → client_id)
CREATE POLICY "client read own line_items" ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_id AND public.is_client_of(auth.uid(), i.client_id)
  ));

CREATE POLICY "client read own recipients" ON public.invoice_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_id AND public.is_client_of(auth.uid(), i.client_id)
  ));

CREATE POLICY "client read own reschedule" ON public.reschedule_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_id AND public.is_client_of(auth.uid(), i.client_id)
  ));
