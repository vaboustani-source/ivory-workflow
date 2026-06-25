
CREATE TABLE public.gmail_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_account_id uuid NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  category text NOT NULL,
  ai_draft text NOT NULL DEFAULT '',
  ai_summary text,
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review','drafted','edited','sent','dismissed','snoozed')),
  last_message_at timestamptz,
  snoozed_until timestamptz,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_action_items TO authenticated;
GRANT ALL ON public.gmail_action_items TO service_role;

ALTER TABLE public.gmail_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own gmail action items"
  ON public.gmail_action_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX gmail_action_items_user_status_idx
  ON public.gmail_action_items (user_id, status, last_message_at DESC);

CREATE TRIGGER gmail_action_items_set_updated_at
  BEFORE UPDATE ON public.gmail_action_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
