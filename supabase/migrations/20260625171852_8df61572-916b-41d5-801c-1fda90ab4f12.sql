
CREATE OR REPLACE FUNCTION public.resolve_oauth_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_staff_role public.app_role;
  v_client_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','deny','reason','no_session');
  END IF;

  SELECT lower(email), COALESCE(raw_user_meta_data->>'full_name', email)
    INTO v_email, v_full_name
  FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RETURN jsonb_build_object('status','deny','reason','no_email');
  END IF;

  SELECT ur.role INTO v_staff_role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE lower(p.email) = v_email
    AND ur.role IN ('owner','studio_manager','associate_photographer')
  ORDER BY CASE ur.role
    WHEN 'owner' THEN 1
    WHEN 'studio_manager' THEN 2
    WHEN 'associate_photographer' THEN 3
    ELSE 9
  END
  LIMIT 1;

  IF v_staff_role IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = v_uid;
    DELETE FROM public.profiles WHERE id = v_uid;
    INSERT INTO public.profiles (id, email, full_name, role)
      VALUES (v_uid, v_email, v_full_name, v_staff_role);
    INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, v_staff_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    RETURN jsonb_build_object('status','allow','side','studio','role',v_staff_role::text);
  END IF;

  SELECT id INTO v_client_id FROM public.clients
   WHERE lower(primary_email) = v_email OR lower(secondary_email) = v_email
   LIMIT 1;
  IF v_client_id IS NULL THEN
    SELECT cu.client_id INTO v_client_id
    FROM public.client_users cu
    JOIN public.profiles p ON p.id = cu.user_id
    WHERE lower(p.email) = v_email
    LIMIT 1;
  END IF;
  IF v_client_id IS NULL THEN
    SELECT client_id INTO v_client_id
    FROM public.portal_invitations
    WHERE lower(invited_email) = v_email
      AND used_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_client_id IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM public.client_users WHERE user_id = v_uid AND client_id = v_client_id
    ) THEN
      INSERT INTO public.client_users (client_id, user_id, role_in_couple)
        VALUES (v_client_id, v_uid, 'partner_1');
    END IF;
    RETURN jsonb_build_object('status','allow','side','portal','client_id', v_client_id);
  END IF;

  DELETE FROM public.user_roles WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE id = v_uid;
  BEGIN
    DELETE FROM auth.users WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('status','deny','reason','not_recognized');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_oauth_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_oauth_login() TO authenticated;
