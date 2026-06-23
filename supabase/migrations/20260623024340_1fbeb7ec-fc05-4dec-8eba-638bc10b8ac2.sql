
-- Slice 6: backfill RPC + audit log on merge

CREATE OR REPLACE FUNCTION public.backfill_vendors_from_questionnaires()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _vendors_created int := 0;
  _links_created int := 0;
  _skipped int := 0;
  r record;
  _key text;
  _value jsonb;
  _category text;
  _name text;
  _instagram text;
  _contact text;
  _email text;
  _phone text;
  _norm text;
  _vendor_id uuid;
  _inserted_link uuid;
  _mapping jsonb := jsonb_build_object(
    'hair_vendor','hair',
    'makeup_vendor','makeup',
    'planner_vendor','planner',
    'dj_band_vendor','dj_band',
    'videographer_vendor','videographer',
    'florist_vendor','florist',
    'caterer_vendor','caterer',
    'baker_vendor','baker',
    'rental_vendor','rentals'
  );
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT q.client_id, q.answers
    FROM public.questionnaires q
    WHERE q.client_id IS NOT NULL
      AND q.answers IS NOT NULL
      AND jsonb_typeof(q.answers) = 'object'
  LOOP
    FOR _key, _value IN SELECT * FROM jsonb_each(r.answers)
    LOOP
      IF NOT (_mapping ? _key) THEN CONTINUE; END IF;
      IF jsonb_typeof(_value) <> 'object' THEN CONTINUE; END IF;

      _category := _mapping ->> _key;
      _name := nullif(btrim(coalesce(_value ->> 'name','')), '');
      _instagram := nullif(btrim(coalesce(_value ->> 'instagram','')), '');
      _contact := nullif(btrim(coalesce(_value ->> 'contact','')), '');

      IF _name IS NULL THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      _email := NULL; _phone := NULL;
      IF _contact IS NOT NULL THEN
        IF position('@' in _contact) > 0 THEN _email := _contact; ELSE _phone := _contact; END IF;
      END IF;

      _norm := public.normalize_vendor_name(_name);
      IF _norm = '' THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      SELECT id INTO _vendor_id
      FROM public.vendors
      WHERE normalized_name = _norm AND category = _category AND merged_into_vendor_id IS NULL
      LIMIT 1;

      IF _vendor_id IS NULL THEN
        INSERT INTO public.vendors (
          name, normalized_name, category, instagram, email, phone,
          source, is_verified, created_by_client_id
        ) VALUES (
          _name, _norm, _category, _instagram, _email, _phone,
          'couple', false, r.client_id
        )
        ON CONFLICT (normalized_name, category) WHERE merged_into_vendor_id IS NULL
        DO NOTHING
        RETURNING id INTO _vendor_id;

        IF _vendor_id IS NOT NULL THEN
          _vendors_created := _vendors_created + 1;
        ELSE
          SELECT id INTO _vendor_id FROM public.vendors
          WHERE normalized_name = _norm AND category = _category AND merged_into_vendor_id IS NULL
          LIMIT 1;
        END IF;
      END IF;

      IF _vendor_id IS NULL THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.wedding_vendors (
        client_id, vendor_id, added_by, point_of_contact_email, point_of_contact_phone
      ) VALUES (
        r.client_id, _vendor_id, 'couple', _email, _phone
      )
      ON CONFLICT (client_id, vendor_id) DO NOTHING
      RETURNING id INTO _inserted_link;

      IF _inserted_link IS NOT NULL THEN
        _links_created := _links_created + 1;
      ELSE
        _skipped := _skipped + 1;
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.activity_log (user_id, action_type, target_type, description, metadata)
  VALUES (
    auth.uid(),
    'vendor.backfill',
    'vendor',
    format('Imported vendors from questionnaires: %s vendors, %s links, %s skipped',
           _vendors_created, _links_created, _skipped),
    jsonb_build_object(
      'vendors_created', _vendors_created,
      'links_created', _links_created,
      'skipped', _skipped
    )
  );

  RETURN jsonb_build_object(
    'vendors_created', _vendors_created,
    'links_created', _links_created,
    'skipped', _skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_vendors_from_questionnaires() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_vendors_from_questionnaires() TO authenticated;

-- Update merge_vendors to also write an audit log entry
CREATE OR REPLACE FUNCTION public.merge_vendors(_loser uuid, _winner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _loser_name text;
  _winner_name text;
  _moved int;
BEGIN
  IF NOT public.is_studio_user(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _loser = _winner THEN
    RAISE EXCEPTION 'cannot merge a vendor into itself' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO _loser_name FROM public.vendors WHERE id = _loser;
  SELECT name INTO _winner_name FROM public.vendors WHERE id = _winner;

  DELETE FROM public.wedding_vendors wv_loser
  WHERE wv_loser.vendor_id = _loser
    AND EXISTS (
      SELECT 1 FROM public.wedding_vendors wv_winner
      WHERE wv_winner.vendor_id = _winner
        AND wv_winner.client_id = wv_loser.client_id
    );

  WITH moved AS (
    UPDATE public.wedding_vendors
    SET vendor_id = _winner, updated_at = now()
    WHERE vendor_id = _loser
    RETURNING 1
  )
  SELECT count(*) INTO _moved FROM moved;

  UPDATE public.vendors
  SET merged_into_vendor_id = _winner, updated_at = now()
  WHERE id = _loser;

  INSERT INTO public.activity_log (user_id, action_type, target_type, target_id, description, metadata)
  VALUES (
    auth.uid(),
    'vendor.merged',
    'vendor',
    _winner,
    format('Merged "%s" into "%s" (%s couple links moved)',
           coalesce(_loser_name,'?'), coalesce(_winner_name,'?'), _moved),
    jsonb_build_object(
      'loser_id', _loser,
      'loser_name', _loser_name,
      'winner_id', _winner,
      'winner_name', _winner_name,
      'links_moved', _moved
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_vendors(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_vendors(uuid, uuid) TO authenticated;
