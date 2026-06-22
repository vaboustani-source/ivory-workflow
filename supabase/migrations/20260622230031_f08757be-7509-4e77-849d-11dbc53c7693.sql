
CREATE OR REPLACE FUNCTION public.create_booking(
  p_call_type_id uuid,
  p_starts_at timestamptz,
  p_primary_email text,
  p_couple_name_1 text,
  p_couple_name_2 text,
  p_phone text,
  p_custom_field_responses jsonb,
  p_visitor_timezone text,
  p_idempotency_key text DEFAULT NULL
) RETURNS TABLE(booking_id uuid, cancel_token uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration int;
  v_active boolean;
  v_studio_tz text;
  v_ends_at timestamptz;
  v_existing record;
  v_overlap_count int;
  v_new_id uuid;
  v_cancel_token uuid;
  v_idem text := NULLIF(p_idempotency_key, '');
BEGIN
  IF v_idem IS NOT NULL THEN
    SELECT b.id, b.cancel_token, b.starts_at, b.ends_at
      INTO v_existing
      FROM public.bookings b
     WHERE b.idempotency_key = v_idem
       AND b.created_at > now() - interval '5 minutes'
     ORDER BY b.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      booking_id := v_existing.id;
      cancel_token := v_existing.cancel_token;
      starts_at := v_existing.starts_at;
      ends_at := v_existing.ends_at;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT ct.duration_minutes, ct.is_active
    INTO v_duration, v_active
    FROM public.call_types ct
   WHERE ct.id = p_call_type_id;
  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'CALL_TYPE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  SELECT timezone INTO v_studio_tz FROM public.scheduling_settings LIMIT 1;
  IF v_studio_tz IS NULL THEN v_studio_tz := 'America/New_York'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_call_type_id::text));

  SELECT count(*) INTO v_overlap_count
    FROM public.bookings b
   WHERE b.call_type_id = p_call_type_id
     AND b.status = 'confirmed'
     AND b.starts_at < v_ends_at
     AND b.ends_at > p_starts_at;
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  v_cancel_token := gen_random_uuid();

  INSERT INTO public.bookings (
    call_type_id, status, starts_at, ends_at,
    timezone_snapshot, visitor_timezone,
    primary_email, couple_name_1, couple_name_2, phone,
    custom_field_responses, source, cancel_token, idempotency_key
  ) VALUES (
    p_call_type_id, 'confirmed', p_starts_at, v_ends_at,
    v_studio_tz, NULLIF(p_visitor_timezone, ''),
    p_primary_email, p_couple_name_1,
    NULLIF(p_couple_name_2, ''), NULLIF(p_phone, ''),
    COALESCE(p_custom_field_responses, '{}'::jsonb), 'public', v_cancel_token, v_idem
  )
  RETURNING id INTO v_new_id;

  booking_id := v_new_id;
  cancel_token := v_cancel_token;
  starts_at := p_starts_at;
  ends_at := v_ends_at;
  RETURN NEXT;
END;
$$;
