
-- Slice 4: booking RPCs + idempotency_key

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS idx_bookings_idempotency_key ON public.bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Atomic booking creation. SECURITY DEFINER, with advisory lock per call_type
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
BEGIN
  -- Idempotency: check for recent matching booking (5 min)
  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) > 0 THEN
    SELECT b.id, b.cancel_token, b.starts_at, b.ends_at
      INTO v_existing
      FROM public.bookings b
     WHERE b.idempotency_key = p_idempotency_key
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

  -- Load call type
  SELECT ct.duration_minutes, ct.is_active
    INTO v_duration, v_active
    FROM public.call_types ct
   WHERE ct.id = p_call_type_id;
  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'CALL_TYPE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  -- Studio tz snapshot
  SELECT timezone INTO v_studio_tz FROM public.scheduling_settings LIMIT 1;
  IF v_studio_tz IS NULL THEN v_studio_tz := 'America/New_York'; END IF;

  -- Advisory lock (transaction scoped) - narrow contention to same call type
  PERFORM pg_advisory_xact_lock(hashtext(p_call_type_id::text));

  -- Re-validate slot: overlap with any confirmed booking on same call type
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
    v_studio_tz, p_visitor_timezone,
    p_primary_email, p_couple_name_1, p_couple_name_2, p_phone,
    COALESCE(p_custom_field_responses, '{}'::jsonb), 'public', v_cancel_token, p_idempotency_key
  )
  RETURNING id INTO v_new_id;

  booking_id := v_new_id;
  cancel_token := v_cancel_token;
  starts_at := p_starts_at;
  ends_at := v_ends_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, timestamptz, text, text, text, text, jsonb, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, timestamptz, text, text, text, text, jsonb, text, text) TO service_role;

-- Public-safe read of booking via cancel_token
CREATE OR REPLACE FUNCTION public.get_booking_by_cancel_token(p_token uuid)
RETURNS TABLE(
  booking_id uuid,
  call_type_name text,
  call_type_slug text,
  duration_minutes int,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone_snapshot text,
  visitor_timezone text,
  couple_name_1 text,
  couple_name_2 text,
  primary_email text,
  status text,
  cancel_token uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    b.id,
    ct.name,
    ct.slug,
    ct.duration_minutes,
    b.starts_at,
    b.ends_at,
    b.timezone_snapshot,
    b.visitor_timezone,
    b.couple_name_1,
    b.couple_name_2,
    b.primary_email,
    b.status::text,
    b.cancel_token
  FROM public.bookings b
  JOIN public.call_types ct ON ct.id = b.call_type_id
  WHERE b.cancel_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_booking_by_cancel_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_booking_by_cancel_token(uuid) TO anon, authenticated, service_role;
