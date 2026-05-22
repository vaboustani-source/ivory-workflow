
-- =========================================================
-- PART 1: user_roles table + secure role resolution
-- =========================================================

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

-- Seed from profiles
INSERT INTO public.user_roles (user_id, role)
SELECT id, role FROM public.profiles
WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Rewrite has_role() to read from user_roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Rewrite role helpers to delegate to has_role (so they all resolve via user_roles)
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'owner'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.is_studio_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'studio_manager'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.is_associate(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'associate_photographer'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.is_studio_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('owner','studio_manager','associate_photographer')
  )
$$;

-- RLS policies on user_roles
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owners read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()));

CREATE POLICY "Owners insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owners update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owners delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_owner(auth.uid()));

-- Block profiles.role changes by non-owners via trigger
CREATE OR REPLACE FUNCTION public._trg_profiles_block_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NULL OR NOT public.is_owner(auth.uid()) THEN
      RAISE EXCEPTION 'Only owners can change a profile role';
    END IF;
    -- Mirror change into user_roles
    DELETE FROM public.user_roles WHERE user_id = NEW.id AND role = OLD.role;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, NEW.role)
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_block_role_change ON public.profiles;
CREATE TRIGGER trg_profiles_block_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._trg_profiles_block_role_change();

-- Update handle_new_user to also seed user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'client');

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =========================================================
-- PART 2: Owner-gate settings tables (read = studio user, write = owner)
-- =========================================================

-- processing_fee_settings
DROP POLICY IF EXISTS "studio all pfs" ON public.processing_fee_settings;
CREATE POLICY "studio reads pfs" ON public.processing_fee_settings
  FOR SELECT TO authenticated USING (public.is_studio_user(auth.uid()));
CREATE POLICY "owner writes pfs" ON public.processing_fee_settings
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- payment_schedule_templates
DROP POLICY IF EXISTS "studio all pst" ON public.payment_schedule_templates;
CREATE POLICY "studio reads pst" ON public.payment_schedule_templates
  FOR SELECT TO authenticated USING (public.is_studio_user(auth.uid()));
CREATE POLICY "owner writes pst" ON public.payment_schedule_templates
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- payment_schedule_template_installments
DROP POLICY IF EXISTS "studio all psti" ON public.payment_schedule_template_installments;
CREATE POLICY "studio reads psti" ON public.payment_schedule_template_installments
  FOR SELECT TO authenticated USING (public.is_studio_user(auth.uid()));
CREATE POLICY "owner writes psti" ON public.payment_schedule_template_installments
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- studio_invoicing_settings
DROP POLICY IF EXISTS "studio all sis" ON public.studio_invoicing_settings;
CREATE POLICY "studio reads sis" ON public.studio_invoicing_settings
  FOR SELECT TO authenticated USING (public.is_studio_user(auth.uid()));
CREATE POLICY "owner writes sis" ON public.studio_invoicing_settings
  FOR ALL TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));
