
-- Helper: is user assigned (as manager or photographer) to a given client?
CREATE OR REPLACE FUNCTION public.is_assigned_to_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = _client_id
      AND (manager_id = auth.uid() OR photographer_id = auth.uid())
  );
$$;

-- Helper: is user an owner?
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'owner');
$$;

-- Helper: is user a studio manager?
CREATE OR REPLACE FUNCTION public.is_studio_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'studio_manager');
$$;

-- Helper: is user an associate photographer?
CREATE OR REPLACE FUNCTION public.is_associate(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'associate_photographer');
$$;

-- ============= CLIENTS =============
DROP POLICY IF EXISTS "Studio manages clients" ON public.clients;

CREATE POLICY "Owner reads all clients" ON public.clients FOR SELECT
  USING (public.is_owner(auth.uid()));
CREATE POLICY "Owner writes all clients" ON public.clients FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Manager reads assigned clients" ON public.clients FOR SELECT
  USING (public.is_studio_manager(auth.uid()) AND (manager_id = auth.uid() OR photographer_id = auth.uid()));
CREATE POLICY "Manager writes assigned clients" ON public.clients FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND (manager_id = auth.uid() OR photographer_id = auth.uid()))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND (manager_id = auth.uid() OR photographer_id = auth.uid()));
-- Allow managers to insert new clients they are assigning to themselves
CREATE POLICY "Manager creates clients" ON public.clients FOR INSERT
  WITH CHECK (public.is_studio_manager(auth.uid()));

CREATE POLICY "Associate reads own photographer clients" ON public.clients FOR SELECT
  USING (public.is_associate(auth.uid()) AND photographer_id = auth.uid());

-- ============= TIMELINE_MILESTONES =============
DROP POLICY IF EXISTS "Studio manages milestones" ON public.timeline_milestones;

CREATE POLICY "Owner manages milestones" ON public.timeline_milestones FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages milestones for assigned clients" ON public.timeline_milestones FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));
CREATE POLICY "Associate reads milestones for own photographer clients" ON public.timeline_milestones FOR SELECT
  USING (public.is_associate(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= TASKS =============
DROP POLICY IF EXISTS "Studio manages tasks" ON public.tasks;

CREATE POLICY "Owner manages tasks" ON public.tasks FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages tasks for assigned clients or own" ON public.tasks FOR ALL
  USING (
    public.is_studio_manager(auth.uid())
    AND (assignee_id = auth.uid() OR client_id IS NULL OR public.is_assigned_to_client(client_id))
  )
  WITH CHECK (
    public.is_studio_manager(auth.uid())
    AND (assignee_id = auth.uid() OR client_id IS NULL OR public.is_assigned_to_client(client_id))
  );
CREATE POLICY "Associate reads own tasks" ON public.tasks FOR SELECT
  USING (public.is_associate(auth.uid()) AND assignee_id = auth.uid());
CREATE POLICY "Associate updates own tasks" ON public.tasks FOR UPDATE
  USING (public.is_associate(auth.uid()) AND assignee_id = auth.uid())
  WITH CHECK (public.is_associate(auth.uid()) AND assignee_id = auth.uid());

-- ============= SCHEDULED_COMMUNICATIONS =============
DROP POLICY IF EXISTS "Studio manages scheduled_communications" ON public.scheduled_communications;

CREATE POLICY "Owner manages scheduled_communications" ON public.scheduled_communications FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages scheduled_communications for assigned" ON public.scheduled_communications FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));
-- Associates: NO access (intentional)

-- ============= CONTRACTS =============
DROP POLICY IF EXISTS "Studio manages contracts" ON public.contracts;
CREATE POLICY "Owner manages contracts" ON public.contracts FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages contracts for assigned" ON public.contracts FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= PROPOSALS =============
DROP POLICY IF EXISTS "Studio manages proposals" ON public.proposals;
CREATE POLICY "Owner manages proposals" ON public.proposals FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages proposals for assigned" ON public.proposals FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= INVOICES =============
DROP POLICY IF EXISTS "Studio manages invoices" ON public.invoices;
CREATE POLICY "Owner manages invoices" ON public.invoices FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages invoices for assigned" ON public.invoices FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= QUESTIONNAIRES =============
DROP POLICY IF EXISTS "Studio manages questionnaires" ON public.questionnaires;
CREATE POLICY "Owner manages questionnaires" ON public.questionnaires FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages questionnaires for assigned" ON public.questionnaires FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= ENGAGEMENT_SESSIONS =============
DROP POLICY IF EXISTS "Studio manages engagement_sessions" ON public.engagement_sessions;
CREATE POLICY "Owner manages engagement_sessions" ON public.engagement_sessions FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages engagement_sessions for assigned" ON public.engagement_sessions FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));
CREATE POLICY "Associate reads engagement_sessions for own clients" ON public.engagement_sessions FOR SELECT
  USING (public.is_associate(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= GALLERIES =============
DROP POLICY IF EXISTS "Studio manages galleries" ON public.galleries;
CREATE POLICY "Owner manages galleries" ON public.galleries FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages galleries for assigned" ON public.galleries FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));
CREATE POLICY "Associate reads galleries for own clients" ON public.galleries FOR SELECT
  USING (public.is_associate(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= ALBUMS =============
DROP POLICY IF EXISTS "Studio manages albums" ON public.albums;
CREATE POLICY "Owner manages albums" ON public.albums FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages albums for assigned" ON public.albums FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= BOOKINGS =============
DROP POLICY IF EXISTS "Studio manages bookings" ON public.bookings;
CREATE POLICY "Owner manages bookings" ON public.bookings FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages bookings for assigned" ON public.bookings FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND (client_id IS NULL OR public.is_assigned_to_client(client_id)))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND (client_id IS NULL OR public.is_assigned_to_client(client_id)));
CREATE POLICY "Associate reads bookings for own clients" ON public.bookings FOR SELECT
  USING (public.is_associate(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= CONVERSATIONS =============
DROP POLICY IF EXISTS "Studio manages conversations" ON public.conversations;
CREATE POLICY "Owner manages conversations" ON public.conversations FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages conversations for assigned" ON public.conversations FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

-- ============= MESSAGES =============
DROP POLICY IF EXISTS "Studio manages messages" ON public.messages;
CREATE POLICY "Owner manages messages" ON public.messages FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));
CREATE POLICY "Manager manages messages for assigned" ON public.messages FOR ALL
  USING (
    public.is_studio_manager(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND public.is_assigned_to_client(c.client_id)
    )
  )
  WITH CHECK (
    public.is_studio_manager(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND public.is_assigned_to_client(c.client_id)
    )
  );
