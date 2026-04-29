DO $$
DECLARE
  v_client_id uuid;
  v_user_id uuid;
  v_email text := 'vaboustani@gmail.com';
  v_password text := 'victoria';
BEGIN
  SELECT id INTO v_client_id 
  FROM public.clients 
  WHERE couple_name_1 ILIKE 'Sophia%' 
  LIMIT 1;
  
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Could not find Sophia client record';
  END IF;
  
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := extensions.uuid_generate_v4();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_sso_user, confirmation_token, recovery_token,
      email_change_token_new, email_change
    )
    VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      jsonb_build_object('full_name', 'Sophia Reyes', 'role', 'client'),
      false, '', '', '', ''
    );
  END IF;
  
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (v_user_id, v_email, 'Sophia Reyes', 'client')
  ON CONFLICT (id) DO UPDATE 
    SET role = 'client', full_name = 'Sophia Reyes';
  
  INSERT INTO public.client_users (client_id, user_id, role_in_couple)
  VALUES (v_client_id, v_user_id, 'partner_1')
  ON CONFLICT DO NOTHING;
  
  UPDATE public.clients 
  SET portal_login_mode = 'shared',
      portal_first_login_at = COALESCE(portal_first_login_at, now())
  WHERE id = v_client_id;
  
  RAISE NOTICE 'Test client login created: % / %', v_email, v_password;
END $$;