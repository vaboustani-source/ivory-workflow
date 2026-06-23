
-- Slice 4: Privacy hardening — drop couples' direct access to public.vendors
DROP POLICY IF EXISTS "Couples read preferred vendors" ON public.vendors;
DROP POLICY IF EXISTS "Couples read their linked vendors" ON public.vendors;
DROP POLICY IF EXISTS "Authenticated insert via RPC" ON public.vendors;

REVOKE INSERT ON public.vendors FROM authenticated;

-- Safe-projection RPCs (SECURITY DEFINER, self-checking)

-- 1. couple_my_vendors: a couple's linked vendors with safe vendor fields (NO notes)
CREATE OR REPLACE FUNCTION public.couple_my_vendors(_client_id uuid)
RETURNS TABLE (
  wedding_vendor_id uuid,
  role_label text,
  couple_notes text,
  point_of_contact text,
  point_of_contact_phone text,
  point_of_contact_email text,
  vendor_id uuid,
  vendor_name text,
  vendor_category text,
  website text,
  instagram text,
  email text,
  phone text,
  is_preferred boolean,
  is_verified boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_studio_user(auth.uid()) OR public.is_client_of(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    wv.id,
    wv.role_label,
    wv.couple_notes,
    wv.point_of_contact,
    wv.point_of_contact_phone,
    wv.point_of_contact_email,
    v.id,
    v.name,
    v.category,
    v.website,
    v.instagram,
    v.email,
    v.phone,
    v.is_preferred,
    v.is_verified,
    wv.created_at
  FROM public.wedding_vendors wv
  JOIN public.vendors v ON v.id = wv.vendor_id
  WHERE wv.client_id = _client_id
  ORDER BY wv.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.couple_my_vendors(uuid) TO authenticated;

-- 2. couple_recommended_vendors: preferred vendors NOT already linked, in categories the couple has not filled.
-- Returns ONLY safe public-facing fields (no email/phone/notes/address).
CREATE OR REPLACE FUNCTION public.couple_recommended_vendors(_client_id uuid)
RETURNS TABLE (
  vendor_id uuid,
  name text,
  category text,
  website text,
  instagram text,
  preferred_blurb text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_studio_user(auth.uid()) OR public.is_client_of(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.name,
    v.category,
    v.website,
    v.instagram,
    v.preferred_blurb
  FROM public.vendors v
  WHERE v.is_preferred = true
    AND v.merged_into_vendor_id IS NULL
    AND v.category NOT IN (
      SELECT DISTINCT v2.category
      FROM public.wedding_vendors wv2
      JOIN public.vendors v2 ON v2.id = wv2.vendor_id
      WHERE wv2.client_id = _client_id
    )
    AND v.id NOT IN (
      SELECT wv3.vendor_id FROM public.wedding_vendors wv3 WHERE wv3.client_id = _client_id
    )
  ORDER BY v.category, v.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.couple_recommended_vendors(uuid) TO authenticated;

-- 3. couple_search_vendors: autocomplete across VERIFIED, non-merged vendors in a category
CREATE OR REPLACE FUNCTION public.couple_search_vendors(
  _client_id uuid,
  _category text,
  _query text
)
RETURNS TABLE (
  vendor_id uuid,
  name text,
  website text,
  instagram text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q text;
BEGIN
  IF NOT (public.is_studio_user(auth.uid()) OR public.is_client_of(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  _q := btrim(coalesce(_query, ''));
  IF length(_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v.id, v.name, v.website, v.instagram
  FROM public.vendors v
  WHERE v.is_verified = true
    AND v.merged_into_vendor_id IS NULL
    AND v.category = _category
    AND (
      v.name ILIKE _q || '%'
      OR v.name ILIKE '%' || _q || '%'
      OR v.normalized_name ILIKE '%' || public.normalize_vendor_name(_q) || '%'
    )
  ORDER BY
    CASE WHEN v.name ILIKE _q || '%' THEN 0 ELSE 1 END,
    v.name
  LIMIT 8;
END;
$$;

GRANT EXECUTE ON FUNCTION public.couple_search_vendors(uuid, text, text) TO authenticated;
