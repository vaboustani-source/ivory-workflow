
-- Vendor Rolodex — Slice 1: SCHEMA ONLY

-- normalize_vendor_name
CREATE OR REPLACE FUNCTION public.normalize_vendor_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(coalesce(_name, '')),
        '[^a-z0-9 ]+', ' ', 'g'
      ),
      '\s+(llc|inc|co|ltd|company)\s*$',
      '', 'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;

-- vendors table (created first, but policies that reference wedding_vendors come AFTER wedding_vendors)
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'planner','florist','caterer','dj_band','videographer','officiant',
    'hair','makeup','baker','rentals','stationery','venue','transportation',
    'photo_booth','other'
  )),
  website text,
  instagram text,
  email text,
  phone text,
  address text,
  notes text,
  is_verified boolean NOT NULL DEFAULT false,
  is_preferred boolean NOT NULL DEFAULT false,
  preferred_blurb text,
  source text NOT NULL DEFAULT 'couple' CHECK (source IN ('couple','studio')),
  created_by_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  merged_into_vendor_id uuid REFERENCES public.vendors(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vendors_dedup_key
  ON public.vendors (normalized_name, category)
  WHERE merged_into_vendor_id IS NULL;

CREATE INDEX vendors_preferred_idx ON public.vendors (category)
  WHERE is_preferred = true AND merged_into_vendor_id IS NULL;

GRANT SELECT, INSERT ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- wedding_vendors junction
CREATE TABLE public.wedding_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  role_label text,
  couple_notes text,
  point_of_contact text,
  point_of_contact_phone text,
  point_of_contact_email text,
  added_by text NOT NULL DEFAULT 'couple' CHECK (added_by IN ('couple','studio')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, vendor_id)
);

CREATE INDEX wedding_vendors_client_idx ON public.wedding_vendors (client_id);
CREATE INDEX wedding_vendors_vendor_idx ON public.wedding_vendors (vendor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_vendors TO authenticated;
GRANT ALL ON public.wedding_vendors TO service_role;

ALTER TABLE public.wedding_vendors ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER wedding_vendors_set_updated_at
  BEFORE UPDATE ON public.wedding_vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- vendors policies
CREATE POLICY "Studio reads vendors" ON public.vendors
  FOR SELECT USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio inserts vendors" ON public.vendors
  FOR INSERT WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio updates vendors" ON public.vendors
  FOR UPDATE USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio deletes vendors" ON public.vendors
  FOR DELETE USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Couples read preferred vendors" ON public.vendors
  FOR SELECT TO authenticated
  USING (is_preferred = true AND merged_into_vendor_id IS NULL);

CREATE POLICY "Couples read their linked vendors" ON public.vendors
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_vendors wv
    WHERE wv.vendor_id = vendors.id
      AND public.is_client_of(auth.uid(), wv.client_id)
  ));

CREATE POLICY "Authenticated insert via RPC" ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- wedding_vendors policies
CREATE POLICY "Studio full access wedding_vendors" ON public.wedding_vendors
  FOR ALL USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Couples read own wedding_vendors" ON public.wedding_vendors
  FOR SELECT TO authenticated
  USING (public.is_client_of(auth.uid(), client_id));
CREATE POLICY "Couples insert own wedding_vendors" ON public.wedding_vendors
  FOR INSERT TO authenticated
  WITH CHECK (public.is_client_of(auth.uid(), client_id));
CREATE POLICY "Couples update own wedding_vendors" ON public.wedding_vendors
  FOR UPDATE TO authenticated
  USING (public.is_client_of(auth.uid(), client_id))
  WITH CHECK (public.is_client_of(auth.uid(), client_id));
CREATE POLICY "Couples delete own wedding_vendors" ON public.wedding_vendors
  FOR DELETE TO authenticated
  USING (public.is_client_of(auth.uid(), client_id));

-- add_vendor_for_client RPC
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
RETURNS TABLE (vendor_id uuid, wedding_vendor_id uuid, created_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _vendor_id uuid;
  _wv_id uuid;
  _created_new boolean := false;
  _allowed_categories text[] := ARRAY[
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

  IF NOT (_category = ANY(_allowed_categories)) THEN
    RAISE EXCEPTION 'invalid category: %', _category USING ERRCODE = '22023';
  END IF;

  _norm := public.normalize_vendor_name(_name);
  IF _norm = '' THEN
    RAISE EXCEPTION 'name normalized to empty' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO _vendor_id
  FROM public.vendors
  WHERE normalized_name = _norm
    AND category = _category
    AND merged_into_vendor_id IS NULL
  LIMIT 1;

  IF _vendor_id IS NULL THEN
    INSERT INTO public.vendors (
      name, normalized_name, category, website, instagram, email, phone, address,
      source, is_verified, created_by_client_id
    ) VALUES (
      btrim(_name), _norm, _category, _website, _instagram, _email, _phone, _address,
      CASE WHEN _is_studio THEN 'studio' ELSE 'couple' END,
      false, _client_id
    )
    RETURNING id INTO _vendor_id;
    _created_new := true;
  END IF;

  INSERT INTO public.wedding_vendors (
    client_id, vendor_id, role_label, couple_notes,
    point_of_contact, point_of_contact_phone, point_of_contact_email,
    added_by
  ) VALUES (
    _client_id, _vendor_id, _role_label, _couple_notes,
    _point_of_contact, _point_of_contact_phone, _point_of_contact_email,
    CASE WHEN _is_studio THEN 'studio' ELSE 'couple' END
  )
  ON CONFLICT (client_id, vendor_id) DO UPDATE SET
    role_label = COALESCE(EXCLUDED.role_label, public.wedding_vendors.role_label),
    couple_notes = COALESCE(EXCLUDED.couple_notes, public.wedding_vendors.couple_notes),
    point_of_contact = COALESCE(EXCLUDED.point_of_contact, public.wedding_vendors.point_of_contact),
    point_of_contact_phone = COALESCE(EXCLUDED.point_of_contact_phone, public.wedding_vendors.point_of_contact_phone),
    point_of_contact_email = COALESCE(EXCLUDED.point_of_contact_email, public.wedding_vendors.point_of_contact_email),
    updated_at = now()
  RETURNING id INTO _wv_id;

  RETURN QUERY SELECT _vendor_id, _wv_id, _created_new;
END;
$$;

REVOKE ALL ON FUNCTION public.add_vendor_for_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_vendor_for_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;

-- merge_vendors RPC
CREATE OR REPLACE FUNCTION public.merge_vendors(_loser uuid, _winner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _loser = _winner THEN
    RAISE EXCEPTION 'cannot merge a vendor into itself' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.wedding_vendors wv_loser
  WHERE wv_loser.vendor_id = _loser
    AND EXISTS (
      SELECT 1 FROM public.wedding_vendors wv_winner
      WHERE wv_winner.vendor_id = _winner
        AND wv_winner.client_id = wv_loser.client_id
    );

  UPDATE public.wedding_vendors
  SET vendor_id = _winner, updated_at = now()
  WHERE vendor_id = _loser;

  UPDATE public.vendors
  SET merged_into_vendor_id = _winner, updated_at = now()
  WHERE id = _loser;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_vendors(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_vendors(uuid, uuid) TO authenticated;
