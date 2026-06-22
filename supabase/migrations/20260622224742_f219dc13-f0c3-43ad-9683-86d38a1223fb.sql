DO $$
DECLARE
  v_owner uuid;
  v_count int;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.scheduling_settings LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'No scheduling_settings row; skipping availability seed.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM public.calendar_availability_rules WHERE user_id = v_owner;
  IF v_count > 0 THEN
    RAISE NOTICE 'Owner % already has % availability rows; skipping seed.', v_owner, v_count;
    RETURN;
  END IF;

  INSERT INTO public.calendar_availability_rules
    (user_id, event_type, available_days, available_hours, is_active)
  VALUES
    (v_owner, 'custom', '[2]'::jsonb,   '{"start":"10:00","end":"15:00"}'::jsonb, true),
    (v_owner, 'custom', '[3]'::jsonb,   '{"start":"17:00","end":"19:00"}'::jsonb, true),
    (v_owner, 'custom', '[4]'::jsonb,   '{"start":"15:00","end":"19:00"}'::jsonb, true),
    (v_owner, 'custom', '[6]'::jsonb,   '{"start":"10:00","end":"14:00"}'::jsonb, true),
    (v_owner, 'custom', '[0]'::jsonb,   '{"start":"10:00","end":"14:00"}'::jsonb, true);
END$$;
