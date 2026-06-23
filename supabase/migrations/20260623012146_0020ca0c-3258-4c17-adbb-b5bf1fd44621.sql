
CREATE OR REPLACE FUNCTION public.get_contractor_1099_report(_tax_year integer)
RETURNS TABLE (
  contractor_id uuid,
  full_name text,
  email text,
  legal_name text,
  mailing_address text,
  business_type text,
  tax_id_type text,
  tax_id_on_file boolean,
  w9_collected boolean,
  w9_collected_at timestamptz,
  w9_requested_at timestamptz,
  w9_file_path text,
  w9_original_filename text,
  total_cents bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.full_name,
    c.email,
    c.legal_name,
    c.mailing_address,
    c.business_type,
    c.tax_id_type,
    (c.tax_id_vault_secret_id IS NOT NULL) AS tax_id_on_file,
    COALESCE(c.w9_collected, false),
    c.w9_collected_at,
    c.w9_requested_at,
    c.w9_file_path,
    c.w9_original_filename,
    y.total_cents
  FROM public.contractor_ytd_pay y
  JOIN public.contractors c ON c.id = y.contractor_id
  WHERE y.tax_year = _tax_year
    AND y.total_cents >= 60000
    AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
  ORDER BY y.total_cents DESC, c.full_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_contractor_1099_report(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contractor_1099_report(integer) TO authenticated;
