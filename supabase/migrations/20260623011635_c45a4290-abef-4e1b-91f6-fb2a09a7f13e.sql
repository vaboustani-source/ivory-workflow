
-- Columns for the on-file W-9 PDF pointer
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS w9_file_path text,
  ADD COLUMN IF NOT EXISTS w9_original_filename text;

-- ============================================================================
-- Storage policies for contractor-tax-docs bucket (owner + studio_manager only)
-- ============================================================================
DROP POLICY IF EXISTS "Owner/manager read contractor-tax-docs" ON storage.objects;
CREATE POLICY "Owner/manager read contractor-tax-docs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contractor-tax-docs'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Owner/manager upload contractor-tax-docs" ON storage.objects;
CREATE POLICY "Owner/manager upload contractor-tax-docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'contractor-tax-docs'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Owner/manager update contractor-tax-docs" ON storage.objects;
CREATE POLICY "Owner/manager update contractor-tax-docs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'contractor-tax-docs'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
)
WITH CHECK (
  bucket_id = 'contractor-tax-docs'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Owner/manager delete contractor-tax-docs" ON storage.objects;
CREATE POLICY "Owner/manager delete contractor-tax-docs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'contractor-tax-docs'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

-- ============================================================================
-- W-9 RPCs (owner + studio_manager only; contractors.UPDATE policy would
-- otherwise let associate_photographer change w9 fields)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_contractor_w9_info(
  _contractor_id uuid,
  _legal_name text,
  _mailing_address text,
  _business_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_contractor_tax_id(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _business_type IS NOT NULL AND _business_type NOT IN (
    'individual','sole_proprietor','single_member_llc',
    'c_corp','s_corp','partnership','trust','other'
  ) THEN
    RAISE EXCEPTION 'invalid business_type';
  END IF;
  UPDATE public.contractors
     SET legal_name = NULLIF(btrim(_legal_name), ''),
         mailing_address = NULLIF(btrim(_mailing_address), ''),
         business_type = _business_type,
         updated_at = now()
   WHERE id = _contractor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_w9_collected(
  _contractor_id uuid,
  _file_path text,
  _filename text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_contractor_tax_id(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.contractors
     SET w9_collected = true,
         w9_collected_at = COALESCE(w9_collected_at, now()),
         w9_file_path = COALESCE(_file_path, w9_file_path),
         w9_original_filename = COALESCE(_filename, w9_original_filename),
         updated_at = now()
   WHERE id = _contractor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_w9(_contractor_id uuid)
RETURNS text  -- returns the prior file_path so the caller can delete the storage object
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_path text;
BEGIN
  IF NOT public.can_manage_contractor_tax_id(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT w9_file_path INTO v_prior_path
  FROM public.contractors WHERE id = _contractor_id;
  UPDATE public.contractors
     SET w9_collected = false,
         w9_collected_at = NULL,
         w9_file_path = NULL,
         w9_original_filename = NULL,
         updated_at = now()
   WHERE id = _contractor_id;
  RETURN v_prior_path;
END;
$$;

REVOKE ALL ON FUNCTION public.save_contractor_w9_info(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_w9_collected(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_w9(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_contractor_w9_info(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_w9_collected(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_w9(uuid) TO authenticated, service_role;
