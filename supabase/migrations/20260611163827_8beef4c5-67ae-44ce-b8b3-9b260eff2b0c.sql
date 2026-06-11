ALTER TABLE public.profiles DISABLE TRIGGER trg_profiles_block_role_change;

UPDATE public.profiles
SET role = 'studio_manager',
    full_name = COALESCE(NULLIF(full_name, 'studio@victoriaboustani.com'), 'Dexter Avilio')
WHERE id = 'bf24c003-eede-4c20-ad6b-c4182888f248';

ALTER TABLE public.profiles ENABLE TRIGGER trg_profiles_block_role_change;

UPDATE public.user_roles
SET role = 'studio_manager'
WHERE user_id = 'bf24c003-eede-4c20-ad6b-c4182888f248';