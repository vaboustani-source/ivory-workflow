
-- Storage RLS for signed-contracts. Path convention: <client_id>/<uuid>.pdf

DROP POLICY IF EXISTS "Studio read signed-contracts" ON storage.objects;
CREATE POLICY "Studio read signed-contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'signed-contracts'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Client read own signed-contracts" ON storage.objects;
CREATE POLICY "Client read own signed-contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'signed-contracts'
  AND public.is_client_of(auth.uid(), (split_part(name, '/', 1))::uuid)
);

DROP POLICY IF EXISTS "Studio upload signed-contracts" ON storage.objects;
CREATE POLICY "Studio upload signed-contracts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'signed-contracts'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Studio update signed-contracts" ON storage.objects;
CREATE POLICY "Studio update signed-contracts"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'signed-contracts'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
)
WITH CHECK (
  bucket_id = 'signed-contracts'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);

DROP POLICY IF EXISTS "Studio delete signed-contracts" ON storage.objects;
CREATE POLICY "Studio delete signed-contracts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'signed-contracts'
  AND (public.is_owner(auth.uid()) OR public.is_studio_manager(auth.uid()))
);
