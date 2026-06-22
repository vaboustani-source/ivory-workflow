
DROP FUNCTION IF EXISTS public.get_booking_by_cancel_token(uuid);

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
  cancel_token uuid,
  zoom_join_url text,
  zoom_password text
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
    b.cancel_token,
    b.zoom_join_url,
    b.zoom_password
  FROM public.bookings b
  JOIN public.call_types ct ON ct.id = b.call_type_id
  WHERE b.cancel_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_booking_by_cancel_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_booking_by_cancel_token(uuid) TO anon, authenticated, service_role;
