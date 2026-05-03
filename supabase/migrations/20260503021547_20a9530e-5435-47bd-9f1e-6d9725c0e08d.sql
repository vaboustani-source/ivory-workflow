
ALTER TABLE public.portrait_sequences
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS couple_review_notes text;

-- Allow couples to update only the approval columns on their own sequence.
DROP POLICY IF EXISTS "Client approves own portrait_sequence" ON public.portrait_sequences;
CREATE POLICY "Client approves own portrait_sequence"
ON public.portrait_sequences
FOR UPDATE
TO authenticated
USING (public.is_client_of(auth.uid(), client_id))
WITH CHECK (public.is_client_of(auth.uid(), client_id));
