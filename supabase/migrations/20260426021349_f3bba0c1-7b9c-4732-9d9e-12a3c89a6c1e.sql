-- 1. SCHEMA ADDITIONS
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_preview text;

-- Make client_id unique so we can ON CONFLICT (client_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_client_id_key'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_client_id_key UNIQUE (client_id);
  END IF;
END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_in_conversation text NOT NULL CHECK (role_in_conversation IN ('owner','manager','photographer','client')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  email_notifications_enabled boolean NOT NULL DEFAULT true,
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cp_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_conversation ON public.conversation_participants(conversation_id);

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size_bytes integer,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- 2. TRIGGERS
CREATE OR REPLACE FUNCTION public.ensure_client_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id uuid;
BEGIN
  INSERT INTO public.conversations (client_id, created_at, updated_at)
  VALUES (NEW.id, now(), now())
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO conv_id;

  IF conv_id IS NULL THEN
    SELECT id INTO conv_id FROM public.conversations WHERE client_id = NEW.id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
  SELECT conv_id, p.id, 'owner' FROM public.profiles p WHERE p.role = 'owner'
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF NEW.manager_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
    VALUES (conv_id, NEW.manager_id, 'manager')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF NEW.photographer_id IS NOT NULL
     AND NEW.photographer_id IS DISTINCT FROM NEW.manager_id THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
    VALUES (conv_id, NEW.photographer_id, 'photographer')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_ensure_client_conversation ON public.clients;
CREATE TRIGGER trigger_ensure_client_conversation
AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.ensure_client_conversation();

CREATE OR REPLACE FUNCTION public.sync_client_conversation_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM public.conversations WHERE client_id = NEW.id;
  IF conv_id IS NULL THEN
    INSERT INTO public.conversations (client_id) VALUES (NEW.id) RETURNING id INTO conv_id;
  END IF;

  IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    IF OLD.manager_id IS NOT NULL THEN
      DELETE FROM public.conversation_participants
      WHERE conversation_id = conv_id AND user_id = OLD.manager_id AND role_in_conversation = 'manager';
    END IF;
    IF NEW.manager_id IS NOT NULL THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
      VALUES (conv_id, NEW.manager_id, 'manager')
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END IF;

  IF NEW.photographer_id IS DISTINCT FROM OLD.photographer_id THEN
    IF OLD.photographer_id IS NOT NULL
       AND OLD.photographer_id IS DISTINCT FROM OLD.manager_id THEN
      DELETE FROM public.conversation_participants
      WHERE conversation_id = conv_id AND user_id = OLD.photographer_id AND role_in_conversation = 'photographer';
    END IF;
    IF NEW.photographer_id IS NOT NULL
       AND NEW.photographer_id IS DISTINCT FROM NEW.manager_id THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
      VALUES (conv_id, NEW.photographer_id, 'photographer')
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_conversation_participants ON public.clients;
CREATE TRIGGER trigger_sync_conversation_participants
AFTER UPDATE OF manager_id, photographer_id ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_conversation_participants();

-- Trigger: keep messages updated metadata in sync on conversation
CREATE OR REPLACE FUNCTION public._trg_messages_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
    SET last_message_at = NEW.created_at,
        last_message_preview = LEFT(COALESCE(NEW.content,''), 120),
        updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_after_insert ON public.messages;
CREATE TRIGGER trg_messages_after_insert
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public._trg_messages_after_insert();

-- 3. BACKFILL existing clients
DO $$
DECLARE c RECORD; conv_id uuid;
BEGIN
  FOR c IN SELECT * FROM public.clients LOOP
    INSERT INTO public.conversations (client_id, created_at, updated_at)
    VALUES (c.id, now(), now())
    ON CONFLICT (client_id) DO NOTHING;

    SELECT id INTO conv_id FROM public.conversations WHERE client_id = c.id;

    INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
    SELECT conv_id, p.id, 'owner' FROM public.profiles p WHERE p.role = 'owner'
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    IF c.manager_id IS NOT NULL THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
      VALUES (conv_id, c.manager_id, 'manager')
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    IF c.photographer_id IS NOT NULL
       AND c.photographer_id IS DISTINCT FROM c.manager_id THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
      VALUES (conv_id, c.photographer_id, 'photographer')
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- 4. RLS POLICIES

-- conversation_participants
DROP POLICY IF EXISTS "Studio reads participants" ON public.conversation_participants;
CREATE POLICY "Studio reads participants"
ON public.conversation_participants FOR SELECT
USING (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "User reads own participants" ON public.conversation_participants;
CREATE POLICY "User reads own participants"
ON public.conversation_participants FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "User updates own participant row" ON public.conversation_participants;
CREATE POLICY "User updates own participant row"
ON public.conversation_participants FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Studio manages participants" ON public.conversation_participants;
CREATE POLICY "Studio manages participants"
ON public.conversation_participants FOR ALL
USING (public.is_studio_user(auth.uid()))
WITH CHECK (public.is_studio_user(auth.uid()));

-- message_attachments (basic studio-only for 3A; clients see attachments tied to non-internal in 3B)
DROP POLICY IF EXISTS "Studio manages message_attachments" ON public.message_attachments;
CREATE POLICY "Studio manages message_attachments"
ON public.message_attachments FOR ALL
USING (public.is_studio_user(auth.uid()))
WITH CHECK (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "Client reads non-internal attachments" ON public.message_attachments;
CREATE POLICY "Client reads non-internal attachments"
ON public.message_attachments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.id = message_attachments.message_id
    AND m.is_internal_note = false
    AND m.deleted_at IS NULL
    AND public.is_client_of(auth.uid(), c.client_id)
));

-- messages: tighten policies for edit window + soft delete + internal notes
DROP POLICY IF EXISTS "Client reads non-internal messages" ON public.messages;
CREATE POLICY "Client reads non-internal messages"
ON public.messages FOR SELECT
USING (
  is_internal_note = false
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.is_client_of(auth.uid(), c.client_id)
  )
);

-- Drop old client INSERT policy if present, replace with stricter one
DROP POLICY IF EXISTS "Client inserts own messages" ON public.messages;
CREATE POLICY "Client inserts own messages"
ON public.messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND is_internal_note = false
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.is_client_of(auth.uid(), c.client_id)
  )
);

-- Studio insert (any internal/public) for assigned clients
DROP POLICY IF EXISTS "Studio inserts messages" ON public.messages;
CREATE POLICY "Studio inserts messages"
ON public.messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_studio_user(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND (public.is_owner(auth.uid()) OR public.is_assigned_to_client(c.client_id))
  )
);

-- Sender edits own message within 15 minutes
DROP POLICY IF EXISTS "Sender edits own recent message" ON public.messages;
CREATE POLICY "Sender edits own recent message"
ON public.messages FOR UPDATE
USING (sender_id = auth.uid() AND created_at > (now() - interval '15 minutes'))
WITH CHECK (sender_id = auth.uid());

-- Owner can update any message (for soft delete / moderation)
DROP POLICY IF EXISTS "Owner updates any message" ON public.messages;
CREATE POLICY "Owner updates any message"
ON public.messages FOR UPDATE
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- Conversations RLS — make sure clients can read their own
DROP POLICY IF EXISTS "Client reads own conversation" ON public.conversations;
CREATE POLICY "Client reads own conversation"
ON public.conversations FOR SELECT
USING (public.is_client_of(auth.uid(), client_id));
