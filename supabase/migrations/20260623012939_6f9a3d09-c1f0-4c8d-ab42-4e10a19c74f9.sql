
-- 1. Track contractor on email sends
ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_sends_contractor_idx ON public.email_sends(contractor_id);

-- 2. Seed editable email template copy. Idempotent via NOT EXISTS check.
INSERT INTO public.email_templates (name, stage, subject, body, merge_fields, requires_approval, is_active, description)
SELECT
  'Contractor — W-9 request',
  'contractor',
  'A quick W-9 request for {tax_year} tax filing',
  E'Hi {contractor_first_name},\n\nThank you for the work you''ve been part of with Stories by Victoria this year. You''ve now passed the $600 threshold the IRS uses for 1099 reporting, so we''ll need a completed W-9 on file before year end.\n\nWhen you have a few minutes, please fill out the latest IRS blank form and send the signed PDF back to {studio_email}:\nhttps://www.irs.gov/pub/irs-pdf/fw9.pdf\n\nWe''ll file it on our side and use it to issue your 1099 in January. Please do not include your SSN or EIN in a reply email; the signed form alone is exactly what we need.\n\nLet us know if anything is unclear, and thank you for keeping this tidy with us.\n\n{studio_signature}',
  '[{"field":"contractor_first_name","desc":"Contractor''s first name"},{"field":"tax_year","desc":"Calendar year, e.g. 2026"},{"field":"studio_email","desc":"Studio return address"},{"field":"w9_form_url","desc":"Link to the blank IRS W-9 PDF"},{"field":"studio_signature","desc":"Studio sign-off"}]'::jsonb,
  false, true,
  'Sent to contractors who have crossed the IRS $600 1099 reporting threshold for the calendar year.'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE name = 'Contractor — W-9 request');

INSERT INTO public.email_templates (name, stage, subject, body, merge_fields, requires_approval, is_active, description)
SELECT
  'Contractor — W-9 reminder',
  'contractor',
  'Friendly nudge on that W-9, {contractor_first_name}',
  E'Hi {contractor_first_name},\n\nCircling back on the W-9 we asked for so we can finish your 1099 filing for {tax_year}. If it''s already on the way, thank you and please ignore.\n\nIf not, here is the blank form again, ready to print or e-sign:\nhttps://www.irs.gov/pub/irs-pdf/fw9.pdf\n\nPlease return the signed PDF to {studio_email}. Do not send your SSN or EIN in the body of an email; the signed form is all we need.\n\nThanks for closing the loop with us.\n\n{studio_signature}',
  '[{"field":"contractor_first_name","desc":"Contractor''s first name"},{"field":"tax_year","desc":"Calendar year"},{"field":"studio_email","desc":"Studio return address"},{"field":"w9_form_url","desc":"Link to the blank IRS W-9 PDF"},{"field":"studio_signature","desc":"Studio sign-off"}]'::jsonb,
  false, true,
  'Gentle follow-up sent if a contractor hasn''t returned their W-9.'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE name = 'Contractor — W-9 reminder');

-- 3. Stash the internal shared secret + endpoint URL in Vault.
DO $$
DECLARE
  v_secret text;
  v_url text := 'https://project--e3bb35b0-f740-4259-80fa-567ec5c67321.lovable.app/api/public/send-w9-request';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'w9_request_shared_secret') THEN
    v_secret := encode(gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_secret, 'w9_request_shared_secret', 'Shared secret for internal W-9 request webhook');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'w9_request_endpoint_url') THEN
    PERFORM vault.create_secret(v_url, 'w9_request_endpoint_url', 'URL of the internal W-9 request webhook');
  END IF;
END $$;

-- 4. SECURITY DEFINER reader, callable only by service_role.
CREATE OR REPLACE FUNCTION public.get_internal_secret(_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_value text;
BEGIN
  SELECT decrypted_secret INTO v_value FROM vault.decrypted_secrets WHERE name = _name;
  RETURN v_value;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_internal_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_internal_secret(text) TO service_role;

-- 5. Ensure a contractor_w9_requests row exists for (contractor, year). Returns the id and whether it was newly created.
CREATE OR REPLACE FUNCTION public.ensure_contractor_w9_request(_contractor_id uuid, _tax_year integer, _created_by uuid DEFAULT NULL)
RETURNS TABLE (request_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_created boolean := false;
BEGIN
  SELECT id INTO v_id
  FROM public.contractor_w9_requests
  WHERE contractor_id = _contractor_id AND tax_year = _tax_year;

  IF v_id IS NULL THEN
    INSERT INTO public.contractor_w9_requests (contractor_id, tax_year, status, created_by)
    VALUES (_contractor_id, _tax_year, 'requested', _created_by)
    ON CONFLICT (contractor_id, tax_year) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id
      FROM public.contractor_w9_requests
      WHERE contractor_id = _contractor_id AND tax_year = _tax_year;
    ELSE
      v_created := true;
      UPDATE public.contractors SET w9_requested_at = now() WHERE id = _contractor_id;
    END IF;
  END IF;

  request_id := v_id;
  created := v_created;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_contractor_w9_request(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_contractor_w9_request(uuid, integer, uuid) TO service_role;

-- 6. Trigger function: on wedding_team write, maybe fire a W-9 request webhook.
CREATE OR REPLACE FUNCTION public.tg_wedding_team_w9_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_enabled boolean;
  v_tax_year integer;
  v_total bigint;
  v_collected boolean;
  v_request_id uuid;
  v_created boolean;
  v_secret text;
  v_url text;
BEGIN
  -- Always swallow errors — never block the originating wedding_team write.
  BEGIN
    IF NEW.contractor_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(w9_auto_request_enabled, false) INTO v_enabled
      FROM public.studio_settings WHERE is_active = true LIMIT 1;
    IF v_enabled IS NOT TRUE THEN
      RETURN NEW;
    END IF;

    SELECT EXTRACT(YEAR FROM c.wedding_date)::int INTO v_tax_year
      FROM public.clients c WHERE c.id = NEW.client_id;
    IF v_tax_year IS NULL THEN RETURN NEW; END IF;

    SELECT total_cents INTO v_total
      FROM public.contractor_ytd_pay
      WHERE contractor_id = NEW.contractor_id AND tax_year = v_tax_year;
    IF v_total IS NULL OR v_total < 60000 THEN RETURN NEW; END IF;

    SELECT COALESCE(w9_collected, false) INTO v_collected FROM public.contractors WHERE id = NEW.contractor_id;
    IF v_collected THEN RETURN NEW; END IF;

    -- Idempotency: only proceed if a request row didn't already exist.
    SELECT request_id, created INTO v_request_id, v_created
      FROM public.ensure_contractor_w9_request(NEW.contractor_id, v_tax_year, NULL);
    IF NOT v_created THEN RETURN NEW; END IF;

    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'w9_request_shared_secret';
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'w9_request_endpoint_url';
    IF v_secret IS NULL OR v_url IS NULL THEN RETURN NEW; END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-w9-secret', v_secret
      ),
      body := jsonb_build_object('request_id', v_request_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_wedding_team_w9_threshold suppressed error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wedding_team_w9_threshold ON public.wedding_team;
CREATE TRIGGER wedding_team_w9_threshold
  AFTER INSERT OR UPDATE OF agreed_total, contractor_id ON public.wedding_team
  FOR EACH ROW EXECUTE FUNCTION public.tg_wedding_team_w9_threshold();
