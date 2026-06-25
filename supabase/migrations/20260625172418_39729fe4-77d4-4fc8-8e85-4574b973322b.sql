
DO $$
DECLARE
  v_staff_uid uuid; v_portal_uid uuid; v_unknown_uid uuid; v_test_client_id uuid;
  v_result jsonb; v_role_count int; v_link_exists boolean; v_residue int;
BEGIN
  -- CASE A: staff
  v_staff_uid := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
    VALUES (v_staff_uid, 'oauth-verify-staff@example.test', '{"full_name":"Staff Tester"}'::jsonb,'authenticated','authenticated','00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles(user_id, role) VALUES (v_staff_uid, 'owner') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_uid::text, 'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  v_result := public.resolve_oauth_login();
  RAISE NOTICE 'CASE A (staff) result: %', v_result;
  PERFORM set_config('role','postgres', true);
  SELECT count(*) INTO v_role_count FROM public.user_roles WHERE user_id=v_staff_uid AND role='client';
  RAISE NOTICE '  leftover client role (expect 0): %', v_role_count;
  SELECT count(*) INTO v_role_count FROM public.user_roles WHERE user_id=v_staff_uid AND role='owner';
  RAISE NOTICE '  owner role (expect 1): %', v_role_count;
  DELETE FROM public.user_roles WHERE user_id=v_staff_uid;
  DELETE FROM public.profiles WHERE id=v_staff_uid;
  DELETE FROM auth.users WHERE id=v_staff_uid;

  -- CASE B: couple
  INSERT INTO public.clients (couple_name_1, primary_email, status)
    VALUES ('OAuth Verify Throwaway', 'oauth-verify-couple@example.test', 'lead')
    RETURNING id INTO v_test_client_id;
  v_portal_uid := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
    VALUES (v_portal_uid, 'oauth-verify-couple@example.test', '{"full_name":"Couple Tester"}'::jsonb,'authenticated','authenticated','00000000-0000-0000-0000-000000000000', now(), now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_portal_uid::text, 'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  v_result := public.resolve_oauth_login();
  RAISE NOTICE 'CASE B (couple) result: %', v_result;
  PERFORM set_config('role','postgres', true);
  SELECT EXISTS(SELECT 1 FROM public.client_users WHERE user_id=v_portal_uid AND client_id=v_test_client_id) INTO v_link_exists;
  RAISE NOTICE '  client_users link (expect t): %', v_link_exists;
  DELETE FROM public.client_users WHERE user_id=v_portal_uid;
  DELETE FROM public.user_roles WHERE user_id=v_portal_uid;
  DELETE FROM public.profiles WHERE id=v_portal_uid;
  DELETE FROM auth.users WHERE id=v_portal_uid;
  DELETE FROM public.clients WHERE id=v_test_client_id;

  -- CASE C: unknown
  v_unknown_uid := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
    VALUES (v_unknown_uid, 'oauth-verify-unknown@example.test', '{"full_name":"Nobody"}'::jsonb,'authenticated','authenticated','00000000-0000-0000-0000-000000000000', now(), now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unknown_uid::text, 'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  v_result := public.resolve_oauth_login();
  RAISE NOTICE 'CASE C (unknown) result: %', v_result;
  PERFORM set_config('role','postgres', true);
  SELECT
    (SELECT count(*) FROM auth.users WHERE id=v_unknown_uid) +
    (SELECT count(*) FROM public.profiles WHERE id=v_unknown_uid) +
    (SELECT count(*) FROM public.user_roles WHERE user_id=v_unknown_uid)
  INTO v_residue;
  RAISE NOTICE '  residue (expect 0): %', v_residue;
  DELETE FROM public.user_roles WHERE user_id=v_unknown_uid;
  DELETE FROM public.profiles WHERE id=v_unknown_uid;
  DELETE FROM auth.users WHERE id=v_unknown_uid;
END $$;
