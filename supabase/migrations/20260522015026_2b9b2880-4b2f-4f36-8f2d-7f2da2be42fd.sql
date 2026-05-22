-- Drop the broad write policy
DROP POLICY IF EXISTS "Studio manages packages" ON public.packages;

-- Studio users (owner/manager/associate) can read all packages
CREATE POLICY "Studio reads packages"
ON public.packages
FOR SELECT
TO authenticated
USING (public.is_studio_user(auth.uid()));

-- Owner-only writes
CREATE POLICY "Owner inserts packages"
ON public.packages
FOR INSERT
TO authenticated
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner updates packages"
ON public.packages
FOR UPDATE
TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Owner deletes packages"
ON public.packages
FOR DELETE
TO authenticated
USING (public.is_owner(auth.uid()));