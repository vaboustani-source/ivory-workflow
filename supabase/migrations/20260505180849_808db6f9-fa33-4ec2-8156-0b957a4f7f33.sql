
-- 1. messages.email_message_id
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS email_message_id text;

CREATE INDEX IF NOT EXISTS idx_messages_email_message_id
  ON public.messages(email_message_id) WHERE email_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conv_email_msgid
  ON public.messages(conversation_id, created_at)
  WHERE email_message_id IS NOT NULL;

-- 2. Update ensure_client_conversation to also add couple users
CREATE OR REPLACE FUNCTION public.ensure_client_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Add couple users (from client_users)
  INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
  SELECT conv_id, cu.user_id, 'client'
  FROM public.client_users cu
  WHERE cu.client_id = NEW.id
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 3. New trigger: when a client_users row is inserted, add them to the conversation
CREATE OR REPLACE FUNCTION public._trg_client_users_add_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM public.conversations WHERE client_id = NEW.client_id;
  IF conv_id IS NULL THEN
    INSERT INTO public.conversations (client_id) VALUES (NEW.client_id) RETURNING id INTO conv_id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
  VALUES (conv_id, NEW.user_id, 'client')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_client_users_add_to_conversation ON public.client_users;
CREATE TRIGGER trg_client_users_add_to_conversation
  AFTER INSERT ON public.client_users
  FOR EACH ROW EXECUTE FUNCTION public._trg_client_users_add_to_conversation();

-- 4. Backfill: add missing couple users to existing conversations
INSERT INTO public.conversation_participants (conversation_id, user_id, role_in_conversation)
SELECT c.id, cu.user_id, 'client'
FROM public.conversations c
JOIN public.client_users cu ON cu.client_id = c.client_id
ON CONFLICT (conversation_id, user_id) DO NOTHING;
