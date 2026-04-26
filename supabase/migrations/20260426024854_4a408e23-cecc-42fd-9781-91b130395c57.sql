
-- ============================================
-- 1. message_reads
-- ============================================
CREATE TABLE public.message_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX idx_message_reads_message ON public.message_reads(message_id);
CREATE INDEX idx_message_reads_user ON public.message_reads(user_id);

ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User inserts own read receipt"
ON public.message_reads FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reads.message_id
      AND m.deleted_at IS NULL
      AND (
        public.is_owner(auth.uid())
        OR (public.is_studio_user(auth.uid()) AND (public.is_owner(auth.uid()) OR public.is_assigned_to_client(c.client_id)))
        OR (m.is_internal_note = false AND public.is_client_of(auth.uid(), c.client_id))
      )
  )
);

CREATE POLICY "Studio reads message_reads"
ON public.message_reads FOR SELECT TO authenticated
USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Client reads receipts on own non-internal messages"
ON public.message_reads FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reads.message_id
      AND m.is_internal_note = false
      AND public.is_client_of(auth.uid(), c.client_id)
  )
);

-- ============================================
-- 2. message_mentions
-- ============================================
CREATE TABLE public.message_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, mentioned_user_id)
);
CREATE INDEX idx_message_mentions_user_unread ON public.message_mentions(mentioned_user_id, read_at);

ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio manages mentions"
ON public.message_mentions FOR ALL TO authenticated
USING (public.is_studio_user(auth.uid()))
WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Mentioned user reads own mentions"
ON public.message_mentions FOR SELECT TO authenticated
USING (mentioned_user_id = auth.uid());

CREATE POLICY "Mentioned user updates own mention read state"
ON public.message_mentions FOR UPDATE TO authenticated
USING (mentioned_user_id = auth.uid())
WITH CHECK (mentioned_user_id = auth.uid());

CREATE POLICY "Client inserts mentions on own non-internal messages"
ON public.message_mentions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_mentions.message_id
      AND m.is_internal_note = false
      AND m.sender_id = auth.uid()
      AND public.is_client_of(auth.uid(), c.client_id)
  )
);

-- ============================================
-- 3. Extend message_attachments
-- ============================================
ALTER TABLE public.message_attachments
  ADD COLUMN IF NOT EXISTS storage_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id);

-- Allow client INSERT/DELETE on attachments tied to their non-internal messages
CREATE POLICY "Client inserts attachments on own non-internal messages"
ON public.message_attachments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_attachments.message_id
      AND m.sender_id = auth.uid()
      AND m.is_internal_note = false
      AND public.is_client_of(auth.uid(), c.client_id)
  )
);

CREATE POLICY "Sender deletes own attachments"
ON public.message_attachments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_attachments.message_id
      AND m.sender_id = auth.uid()
  )
  OR public.is_owner(auth.uid())
);

-- ============================================
-- 4. Realtime publication
-- ============================================
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reads REPLICA IDENTITY FULL;
ALTER TABLE public.message_mentions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_mentions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_mentions';
  END IF;
END $$;

-- ============================================
-- 5. Storage bucket: message-attachments
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  26214400,
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','image/heic','image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = EXCLUDED.public;

-- Storage policies on storage.objects
CREATE POLICY "Participants upload to message-attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND (
    public.is_owner(auth.uid())
    OR (
      (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ((storage.foldername(name))[1])::uuid IN (
        SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Participants read message-attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (
    public.is_owner(auth.uid())
    OR (
      (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ((storage.foldername(name))[1])::uuid IN (
        SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Owner and uploader delete message-attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (
    public.is_owner(auth.uid())
    OR owner = auth.uid()
  )
);
