
-- ============================================================================
-- Slice 1: Contractor W-9 / 1099 — schema, encryption plumbing, view, flag
-- ============================================================================

-- 1. Add columns to contractors -------------------------------------------------
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS mailing_address text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS tax_id_type text,
  ADD COLUMN IF NOT EXISTS tax_id_vault_secret_id uuid,
  ADD COLUMN IF NOT EXISTS w9_collected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS w9_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS w9_requested_at timestamptz;

-- Allowed values for W-9 tax classification (line 3 of the form)
ALTER TABLE public.contractors
  DROP CONSTRAINT IF EXISTS contractors_business_type_check;
ALTER TABLE public.contractors
  ADD CONSTRAINT contractors_business_type_check
  CHECK (business_type IS NULL OR business_type IN (
    'individual','sole_proprietor','single_member_llc',
    'c_corp','s_corp','partnership','trust','other'
  ));

ALTER TABLE public.contractors
  DROP CONSTRAINT IF EXISTS contractors_tax_id_type_check;
ALTER TABLE public.contractors
  ADD CONSTRAINT contractors_tax_id_type_check
  CHECK (tax_id_type IS NULL OR tax_id_type IN ('ssn','ein'));

-- 2. contractor_w9_requests ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contractor_w9_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  tax_year int NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','sent','completed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  email_send_id uuid REFERENCES public.email_sends(id) ON DELETE SET NULL,
  created_by uuid,
  CONSTRAINT contractor_w9_requests_unique_per_year UNIQUE (contractor_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_w9_req_contractor ON public.contractor_w9_requests(contractor_id);
CREATE INDEX IF NOT EXISTS idx_w9_req_year ON public.contractor_w9_requests(tax_year);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_w9_requests TO authenticated;
GRANT ALL ON public.contractor_w9_requests TO service_role;

ALTER TABLE public.contractor_w9_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages contractor_w9_requests" ON public.contractor_w9_requests;
CREATE POLICY "Owner manages contractor_w9_requests"
ON public.contractor_w9_requests FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Studio manager manages contractor_w9_requests" ON public.contractor_w9_requests;
CREATE POLICY "Studio manager manages contractor_w9_requests"
ON public.contractor_w9_requests FOR ALL TO authenticated
USING (public.is_studio_manager(auth.uid()))
WITH CHECK (public.is_studio_manager(auth.uid()));

-- 3. contractor_ytd_pay view ---------------------------------------------------
CREATE OR REPLACE VIEW public.contractor_ytd_pay
WITH (security_invoker = true) AS
SELECT
  wt.contractor_id,
  EXTRACT(YEAR FROM c.wedding_date)::int AS tax_year,
  COALESCE(SUM(wt.agreed_total), 0)::bigint AS total_cents
FROM public.wedding_team wt
JOIN public.clients c ON c.id = wt.client_id
WHERE c.wedding_date IS NOT NULL
  AND wt.contractor_id IS NOT NULL
GROUP BY wt.contractor_id, EXTRACT(YEAR FROM c.wedding_date);

GRANT SELECT ON public.contractor_ytd_pay TO authenticated;

-- 4. Feature flag on studio_settings -------------------------------------------
ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS w9_auto_request_enabled boolean NOT NULL DEFAULT false;

-- 5. Encrypted tax-id read/write via Vault -------------------------------------
-- Helper: gate to owner OR studio_manager.
CREATE OR REPLACE FUNCTION public.can_manage_contractor_tax_id(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _uid IS NOT NULL AND (
    public.is_owner(_uid) OR public.is_studio_manager(_uid)
  )
$$;

-- WRITE: set or rotate the encrypted tax id for a contractor.
CREATE OR REPLACE FUNCTION public.set_contractor_tax_id(
  _contractor_id uuid,
  _plaintext text,
  _type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_caller uuid := auth.uid();
  v_name text;
BEGIN
  IF NOT public.can_manage_contractor_tax_id(v_caller) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _plaintext IS NULL OR length(btrim(_plaintext)) = 0 THEN
    RAISE EXCEPTION 'plaintext required';
  END IF;
  IF _type NOT IN ('ssn','ein') THEN
    RAISE EXCEPTION 'tax_id_type must be ssn or ein';
  END IF;

  SELECT tax_id_vault_secret_id INTO v_existing_id
  FROM public.contractors WHERE id = _contractor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contractor not found';
  END IF;

  v_name := 'contractor_tax_id_' || _contractor_id::text;

  IF v_existing_id IS NULL THEN
    v_new_id := vault.create_secret(_plaintext, v_name, 'Contractor W-9 tax id');
    UPDATE public.contractors
       SET tax_id_vault_secret_id = v_new_id,
           tax_id_type = _type,
           updated_at = now()
     WHERE id = _contractor_id;
  ELSE
    PERFORM vault.update_secret(v_existing_id, _plaintext, v_name, 'Contractor W-9 tax id');
    UPDATE public.contractors
       SET tax_id_type = _type,
           updated_at = now()
     WHERE id = _contractor_id;
  END IF;
END;
$$;

-- READ: decrypt and return the tax id. Owner/manager only.
CREATE OR REPLACE FUNCTION public.get_contractor_tax_id(_contractor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_secret_id uuid;
  v_plain text;
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.can_manage_contractor_tax_id(v_caller) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT tax_id_vault_secret_id INTO v_secret_id
  FROM public.contractors WHERE id = _contractor_id;
  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_plain
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_plain;
END;
$$;

-- CLEAR: delete the encrypted tax id.
CREATE OR REPLACE FUNCTION public.clear_contractor_tax_id(_contractor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_secret_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.can_manage_contractor_tax_id(v_caller) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT tax_id_vault_secret_id INTO v_secret_id
  FROM public.contractors WHERE id = _contractor_id;
  IF v_secret_id IS NOT NULL THEN
    UPDATE public.contractors
       SET tax_id_vault_secret_id = NULL,
           tax_id_type = NULL,
           updated_at = now()
     WHERE id = _contractor_id;
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;
END;
$$;

-- Lock down execute: authenticated may call (function self-checks role); revoke from anon.
REVOKE ALL ON FUNCTION public.set_contractor_tax_id(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_contractor_tax_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_contractor_tax_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_contractor_tax_id(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_contractor_tax_id(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_contractor_tax_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_contractor_tax_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_contractor_tax_id(uuid) TO authenticated, service_role;
