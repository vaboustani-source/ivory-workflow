CREATE TABLE public.email_template_copy (
  email_type text PRIMARY KEY,
  copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_template_copy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads email_template_copy"
ON public.email_template_copy
FOR SELECT
USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner inserts email_template_copy"
ON public.email_template_copy
FOR INSERT
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates email_template_copy"
ON public.email_template_copy
FOR UPDATE
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_email_template_copy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_email_template_copy
BEFORE UPDATE ON public.email_template_copy
FOR EACH ROW
EXECUTE FUNCTION public.touch_email_template_copy();

INSERT INTO public.email_template_copy (email_type, copy) VALUES
  ('portal_invite', '{}'::jsonb),
  ('message_notification', '{}'::jsonb),
  ('contract_sent', '{}'::jsonb),
  ('form_sent', '{}'::jsonb),
  ('contract_receipt', '{}'::jsonb)
ON CONFLICT (email_type) DO NOTHING;