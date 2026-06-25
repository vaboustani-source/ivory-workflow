
-- Per-user Gmail mailbox connections. Mirrors calendar_connections approach:
-- tokens stored plaintext, never reachable from anon/authenticated PostgREST
-- (no SELECT/INSERT grants to those roles). All access is via service_role
-- inside server functions/routes that have already authenticated the user.

CREATE TABLE public.gmail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],
  history_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gmail_accounts_user_active_idx
  ON public.gmail_accounts (user_id) WHERE is_active = true;

-- One active row per (user, email)
CREATE UNIQUE INDEX gmail_accounts_unique_active
  ON public.gmail_accounts (user_id, email) WHERE is_active = true;

-- Grants: service_role only. We never expose this table to anon or
-- authenticated PostgREST — tokens never leave the server.
GRANT ALL ON public.gmail_accounts TO service_role;

ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth RLS: even if a future GRANT to authenticated is added,
-- a user can ONLY see/modify their own row.
CREATE POLICY "Users manage own gmail accounts"
  ON public.gmail_accounts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at trigger (reuses existing public.update_updated_at_column())
CREATE TRIGGER gmail_accounts_set_updated_at
  BEFORE UPDATE ON public.gmail_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
