
DROP FUNCTION IF EXISTS public.add_vendor_for_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.add_vendor_for_client(
  _client_id uuid,
  _name text,
  _category text,
  _website text DEFAULT NULL,
  _instagram text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _address text DEFAULT NULL,
  _role_label text DEFAULT NULL,
  _couple_notes text DEFAULT NULL,
  _point_of_contact text DEFAULT NULL,
  _point_of_contact_phone text DEFAULT NULL,
  _point_of_contact_email text DEFAULT NULL
)
RETURNS TABLE (out_vendor_id uuid, out_wedding_vendor_id uuid, out_created_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _vid uuid;
  _wvid uuid;
  _new boolean := false;
  _allowed text[] := ARRAY[
    'planner','florist','caterer','dj_band','videographer','officiant',
    'hair','makeup','baker','rentals','stationery','venue','transportation',
    'photo_booth','other'
  ];
  _is_studio boolean;
BEGIN
  _is_studio := public.is_studio_user(auth.uid());
  IF NOT (_is_studio OR public.is_client_of(auth.uid(), _client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'name required' USING ERRCODE = '22023';
  END IF;
  IF NOT (_category = ANY(_allowed)) THEN
    RAISE EXCEPTION 'invalid category: %', _category USING ERRCODE = '22023';
  END IF;
  _norm := public.normalize_vendor_name(_name);
  IF _norm = '' THEN
    RAISE EXCEPTION 'name normalized to empty' USING ERRCODE = '22023';
  END IF;

  SELECT v.id INTO _vid
  FROM public.vendors v
  WHERE v.normalized_name = _norm
    AND v.category = _category
    AND v.merged_into_vendor_id IS NULL
  LIMIT 1;

  IF _vid IS NULL THEN
    INSERT INTO public.vendors (
      name, normalized_name, category, website, instagram, email, phone, address,
      source, is_verified, created_by_client_id
    ) VALUES (
      btrim(_name), _norm, _category, _website, _instagram, _email, _phone, _address,
      CASE WHEN _is_studio THEN 'studio' ELSE 'couple' END,
      false, _client_id
    )
    RETURNING id INTO _vid;
    _new := true;
  END IF;

  INSERT INTO public.wedding_vendors AS w (
    client_id, vendor_id, role_label, couple_notes,
    point_of_contact, point_of_contact_phone, point_of_contact_email,
    added_by
  ) VALUES (
    _client_id, _vid, _role_label, _couple_notes,
    _point_of_contact, _point_of_contact_phone, _point_of_contact_email,
    CASE WHEN _is_studio THEN 'studio' ELSE 'couple' END
  )
  ON CONFLICT (client_id, vendor_id) DO UPDATE SET
    role_label = COALESCE(EXCLUDED.role_label, w.role_label),
    couple_notes = COALESCE(EXCLUDED.couple_notes, w.couple_notes),
    point_of_contact = COALESCE(EXCLUDED.point_of_contact, w.point_of_contact),
    point_of_contact_phone = COALESCE(EXCLUDED.point_of_contact_phone, w.point_of_contact_phone),
    point_of_contact_email = COALESCE(EXCLUDED.point_of_contact_email, w.point_of_contact_email),
    updated_at = now()
  RETURNING w.id INTO _wvid;

  out_vendor_id := _vid;
  out_wedding_vendor_id := _wvid;
  out_created_new := _new;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.add_vendor_for_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_vendor_for_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;
