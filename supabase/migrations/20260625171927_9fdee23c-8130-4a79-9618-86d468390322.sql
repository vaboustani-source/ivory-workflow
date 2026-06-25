
DO $$
DECLARE
  v_couple_email text := 'gtest_couple_' || substr(md5(random()::text),1,8) || '@example.com';
  v_client_id uuid := gen_random_uuid();
  v_google_couple_uid uuid := gen_random_uuid();
  v_unknown_email text := 'gtest_unknown_' || substr(md5(random()::text),1,8) || '@example.com';
  v_google_unknown_uid uuid := gen_random_uuid();
  r_b jsonb;
  r_c jsonb;
  link_count int;
  link_role text;
  res_auth int; res_prof int; res_role int; res_link int;
BEGIN
  -- CASE B
  INSERT INTO public.clients(id, couple_name_1, primary_email)
    VALUES (v_client_id, 'Test Couple', v_couple_email);
  INSERT INTO auth.users(id, email, instance_id, aud, role)
    VALUES (v_google_couple_uid, v_couple_email, '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_google_couple_uid::text, 'role','authenticated')::text, true);
  SELECT public.resolve_oauth_login() INTO r_b;
  SELECT count(*) INTO link_count FROM public.client_users WHERE user_id=v_google_couple_uid AND client_id=v_client_id;
  SELECT role::text INTO link_role FROM public.profiles WHERE id=v_google_couple_uid;

  -- CASE C
  INSERT INTO auth.users(id, email, instance_id, aud, role)
    VALUES (v_google_unknown_uid, v_unknown_email, '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_google_unknown_uid::text, 'role','authenticated')::text, true);
  SELECT public.resolve_oauth_login() INTO r_c;
  SELECT count(*) INTO res_auth FROM auth.users WHERE id=v_google_unknown_uid;
  SELECT count(*) INTO res_prof FROM public.profiles WHERE id=v_google_unknown_uid;
  SELECT count(*) INTO res_role FROM public.user_roles WHERE user_id=v_google_unknown_uid;
  SELECT count(*) INTO res_link FROM public.client_users WHERE user_id=v_google_unknown_uid;

  RAISE NOTICE 'CASE B result=% | link_rows=% | profile_role=%', r_b, link_count, link_role;
  RAISE NOTICE 'CASE C result=% | residue auth/prof/roles/link = %/%/%/%', r_c, res_auth, res_prof, res_role, res_link;

  -- CLEANUP (order matters: child rows then parents)
  DELETE FROM public.client_users WHERE user_id = v_google_couple_uid;
  DELETE FROM public.user_roles WHERE user_id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM public.profiles WHERE id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM auth.users WHERE id IN (v_google_couple_uid, v_google_unknown_uid);
  DELETE FROM public.clients WHERE id = v_client_id;
END $$;
