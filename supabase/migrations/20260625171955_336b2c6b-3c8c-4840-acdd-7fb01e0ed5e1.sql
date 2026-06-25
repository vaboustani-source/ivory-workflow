
CREATE TABLE IF NOT EXISTS public._oauth_login_verify (
  id bigserial PRIMARY KEY,
  case_name text,
  rpc_result jsonb,
  detail jsonb,
  created_at timestamptz DEFAULT now()
);

DO $$
DECLARE
  v_couple_email text := 'gtest_couple_' || substr(md5(random()::text),1,8) || '@example.com';
  v_client_id uuid := gen_random_uuid();
  v_google_couple_uid uuid := gen_random_uuid();
  v_unknown_email text := 'gtest_unknown_' || substr(md5(random()::text),1,8) || '@example.com';
  v_google_unknown_uid uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO public.clients(id, couple_name_1, primary_email)
    VALUES (v_client_id, 'Test Couple', v_couple_email);
  INSERT INTO auth.users(id, email, instance_id, aud, role)
    VALUES (v_google_couple_uid, v_couple_email, '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_google_couple_uid::text, 'role','authenticated')::text, true);
  SELECT public.resolve_oauth_login() INTO r;
  INSERT INTO public._oauth_login_verify(case_name, rpc_result, detail)
  VALUES (
    'B_couple', r,
    jsonb_build_object(
      'link_rows', (SELECT count(*) FROM public.client_users WHERE user_id=v_google_couple_uid AND client_id=v_client_id),
      'profile_role', (SELECT role::text FROM public.profiles WHERE id=v_google_couple_uid),
      'has_client_user_role', (SELECT count(*) FROM public.user_roles WHERE user_id=v_google_couple_uid AND role='client')
    )
  );

  INSERT INTO auth.users(id, email, instance_id, aud, role)
    VALUES (v_google_unknown_uid, v_unknown_email, '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_google_unknown_uid::text, 'role','authenticated')::text, true);
  SELECT public.resolve_oauth_login() INTO r;
  INSERT INTO public._oauth_login_verify(case_name, rpc_result, detail)
  VALUES (
    'C_unknown', r,
    jsonb_build_object(
      'residue_auth', (SELECT count(*) FROM auth.users WHERE id=v_google_unknown_uid),
      'residue_profile', (SELECT count(*) FROM public.profiles WHERE id=v_google_unknown_uid),
      'residue_role', (SELECT count(*) FROM public.user_roles WHERE user_id=v_google_unknown_uid),
      'residue_link', (SELECT count(*) FROM public.client_users WHERE user_id=v_google_unknown_uid)
    )
  );

  DELETE FROM public.client_users WHERE user_id = v_google_couple_uid;
  DELETE FROM public.user_roles WHERE user_id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM public.profiles WHERE id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM auth.users WHERE id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM public.clients WHERE id = v_client_id;
END $$;
