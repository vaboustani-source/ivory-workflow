-- Extend clients with portal login mode
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_login_mode text DEFAULT 'pending'
  CHECK (portal_login_mode IN ('pending', 'shared', 'separate'));

-- Extend client_users with partner + notification prefs
ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS partner_email text,
  ADD COLUMN IF NOT EXISTS partner_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS notification_email_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_messages_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_milestones_enabled boolean NOT NULL DEFAULT true;

-- Portal invitations
CREATE TABLE IF NOT EXISTS public.portal_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  invited_by uuid REFERENCES public.profiles(id),
  invitation_token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  invitation_type text NOT NULL CHECK (invitation_type IN ('initial', 'partner', 'resend')),
  invited_role_in_couple text DEFAULT 'partner_2' CHECK (invited_role_in_couple IN ('partner_1', 'partner_2')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_invitations_token ON public.portal_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_portal_invitations_client ON public.portal_invitations(client_id);

ALTER TABLE public.portal_invitations ENABLE ROW LEVEL SECURITY;

-- Owner manages all invitations
CREATE POLICY "Owner manages portal_invitations"
  ON public.portal_invitations
  FOR ALL
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- Studio managers/associates can read + create invitations for clients they're assigned to
CREATE POLICY "Studio reads assigned portal_invitations"
  ON public.portal_invitations
  FOR SELECT
  USING (public.is_studio_user(auth.uid()) AND public.is_assigned_to_client(client_id));

CREATE POLICY "Studio creates assigned portal_invitations"
  ON public.portal_invitations
  FOR INSERT
  WITH CHECK (public.is_studio_user(auth.uid()) AND public.is_assigned_to_client(client_id));

-- Public lookup by token (so unauth /portal/welcome page can validate);
-- this only exposes the invitation row itself, not joined client data.
CREATE POLICY "Anyone can read invitation by token"
  ON public.portal_invitations
  FOR SELECT
  TO anon, authenticated
  USING (true);