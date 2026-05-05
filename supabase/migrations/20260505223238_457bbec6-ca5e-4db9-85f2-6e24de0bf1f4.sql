
-- A. workflow_steps client-facing fields
ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS client_facing_label text,
  ADD COLUMN IF NOT EXISTS client_facing_description text,
  ADD COLUMN IF NOT EXISTS client_action_url text;

-- B. timeline_milestones client-facing fields
ALTER TABLE public.timeline_milestones
  ADD COLUMN IF NOT EXISTS client_facing_label text,
  ADD COLUMN IF NOT EXISTS client_facing_description text,
  ADD COLUMN IF NOT EXISTS client_action_url text;

-- C. activity_log additions
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_facing_text text;

CREATE INDEX IF NOT EXISTS idx_activity_log_client_visible
  ON public.activity_log(client_id, is_client_visible, created_at DESC)
  WHERE is_client_visible = true;

CREATE INDEX IF NOT EXISTS idx_activity_log_client
  ON public.activity_log(client_id, created_at DESC);

-- Backfill client_id from prior rows where target_type='client'
UPDATE public.activity_log
   SET client_id = target_id
 WHERE client_id IS NULL AND target_type = 'client';

-- Backfill from milestones
UPDATE public.activity_log a
   SET client_id = m.client_id
  FROM public.timeline_milestones m
 WHERE a.client_id IS NULL AND a.target_type = 'milestone' AND a.target_id = m.id;

-- D. RLS for activity_log: drop the old broad SELECT, add scoped policies
DROP POLICY IF EXISTS "Studio reads activity_log" ON public.activity_log;

CREATE POLICY "Studio reads scoped activity_log"
ON public.activity_log
FOR SELECT
USING (
  is_owner(auth.uid())
  OR (is_studio_user(auth.uid()) AND client_id IS NOT NULL AND is_assigned_to_client(client_id))
  OR (is_studio_user(auth.uid()) AND client_id IS NULL)
);

CREATE POLICY "Client reads own visible activity_log"
ON public.activity_log
FOR SELECT
USING (
  client_id IS NOT NULL
  AND is_client_visible = true
  AND is_client_of(auth.uid(), client_id)
);

-- E. Update materialize_workflow_for_client to copy client-facing fields
CREATE OR REPLACE FUNCTION public.materialize_workflow_for_client(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_template_id uuid;
  v_step RECORD;
  v_anchor date;
  v_due date;
  v_inserted integer := 0;
  v_milestone_id uuid;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_template_id FROM public.workflow_templates WHERE is_active = true ORDER BY version DESC LIMIT 1;
  IF v_template_id IS NULL THEN RETURN; END IF;

  FOR v_step IN
    SELECT * FROM public.workflow_steps
    WHERE workflow_template_id = v_template_id
    ORDER BY step_number
  LOOP
    IF NOT public._branch_passes(v_step.branch_dependency, v_client) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.timeline_milestones
      WHERE client_id = p_client_id AND workflow_step_id = v_step.id
    ) THEN
      CONTINUE;
    END IF;

    IF v_step.trigger_type = 'event' THEN
      CONTINUE;
    END IF;

    IF v_step.trigger_type = 'manual' THEN
      v_due := NULL;
    ELSE
      v_anchor := public._anchor_date(p_client_id, v_step.trigger_relative_to::text, v_step.id);
      IF v_anchor IS NULL THEN
        CONTINUE;
      END IF;

      IF v_step.trigger_uses_business_days THEN
        v_due := public.add_business_days(v_anchor, COALESCE(v_step.trigger_offset_days,0));
      ELSE
        v_due := v_anchor + COALESCE(v_step.trigger_offset_days,0);
      END IF;
    END IF;

    INSERT INTO public.timeline_milestones (
      client_id, workflow_step_id, title, description, due_date,
      status, is_client_visible, is_overridden,
      action_type, responsible_party, stage,
      client_facing_label, client_facing_description, client_action_url
    ) VALUES (
      p_client_id, v_step.id, v_step.title, v_step.description, v_due,
      'upcoming', v_step.is_client_visible, false,
      v_step.action_type::text, v_step.responsible_party::text, v_step.stage,
      v_step.client_facing_label, v_step.client_facing_description, v_step.client_action_url
    ) RETURNING id INTO v_milestone_id;

    v_inserted := v_inserted + 1;

    IF v_step.action_type::text = 'draft_email' THEN
      PERFORM public._draft_scheduled_communication(v_milestone_id);
    END IF;

    PERFORM public._log_activity(
      'milestone_created','milestone',v_milestone_id,
      'Created milestone: ' || v_step.title,
      auth.uid(),
      jsonb_build_object('client_id', p_client_id, 'stage', v_step.stage, 'due_date', v_due)
    );
  END LOOP;

  PERFORM public._log_activity(
    'workflow_materialized','client',p_client_id,
    'Materialized ' || v_inserted || ' milestone' || CASE WHEN v_inserted=1 THEN '' ELSE 's' END,
    auth.uid(),
    jsonb_build_object('count', v_inserted, 'template_id', v_template_id)
  );
END;
$function$;

-- F. Update trigger_event_handler similarly
CREATE OR REPLACE FUNCTION public.trigger_event_handler(p_client_id uuid, p_event_name text, p_event_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_template_id uuid;
  v_step RECORD;
  v_milestone_id uuid;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_template_id FROM public.workflow_templates WHERE is_active = true ORDER BY version DESC LIMIT 1;
  IF v_template_id IS NULL THEN RETURN; END IF;

  FOR v_step IN
    SELECT * FROM public.workflow_steps
    WHERE workflow_template_id = v_template_id
      AND trigger_type = 'event'
      AND trigger_event = p_event_name
  LOOP
    IF NOT public._branch_passes(v_step.branch_dependency, v_client) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.timeline_milestones
      WHERE client_id = p_client_id AND workflow_step_id = v_step.id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.timeline_milestones (
      client_id, workflow_step_id, title, description, due_date,
      status, is_client_visible, is_overridden,
      action_type, responsible_party, stage, metadata,
      client_facing_label, client_facing_description, client_action_url
    ) VALUES (
      p_client_id, v_step.id, v_step.title, v_step.description, CURRENT_DATE,
      'upcoming', v_step.is_client_visible, false,
      v_step.action_type::text, v_step.responsible_party::text, v_step.stage,
      COALESCE(p_event_metadata,'{}'::jsonb),
      v_step.client_facing_label, v_step.client_facing_description, v_step.client_action_url
    ) RETURNING id INTO v_milestone_id;

    IF v_step.action_type::text = 'draft_email' THEN
      PERFORM public._draft_scheduled_communication(v_milestone_id);
    END IF;

    PERFORM public._log_activity(
      'milestone_created','milestone',v_milestone_id,
      'Event "' || p_event_name || '" → created milestone: ' || v_step.title,
      auth.uid(),
      jsonb_build_object('client_id', p_client_id, 'event', p_event_name)
    );
  END LOOP;

  PERFORM public.materialize_workflow_for_client(p_client_id);
END;
$function$;

-- G. Seed couple-facing labels
UPDATE public.workflow_steps SET
  client_facing_label = 'Time to plan your engagement session',
  client_facing_description = 'Pick a date and location for your engagement shoot.',
  client_action_url = '/portal/messages'
WHERE title ILIKE '%engagement%branch%' OR title ILIKE '%schedule engagement%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Sign your contract',
  client_facing_description = 'Review and sign to lock in your wedding date.',
  client_action_url = '/portal/documents'
WHERE title ILIKE 'Contract sent%' OR title ILIKE '%send contract%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Fill out wedding details',
  client_facing_description = 'A 49-question form covering everything we need to know.',
  client_action_url = '/portal/questionnaires'
WHERE title ILIKE 'Send Wedding Details%' OR title ILIKE '%Logistics form%' OR title ILIKE '%logistics%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Your sneak peeks are coming',
  client_facing_description = 'Get ready for a first look at your favorite shots.',
  client_action_url = NULL
WHERE title ILIKE 'Sneak peeks%' OR title ILIKE '%sneak peek%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Your gallery is ready',
  client_facing_description = 'View, download, and share your wedding photos.',
  client_action_url = '/portal/gallery'
WHERE title ILIKE 'Gallery delivered%' OR title ILIKE '%deliver gallery%' OR title ILIKE '%gallery ready%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Pay your retainer',
  client_facing_description = 'Lock in your date by paying the retainer invoice.',
  client_action_url = '/portal/invoices'
WHERE title ILIKE '%retainer%invoice%' OR title ILIKE '%send retainer%';

UPDATE public.workflow_steps SET
  client_facing_label = 'Review your family portrait list',
  client_facing_description = 'Confirm or edit the family portraits we will capture on your day.',
  client_action_url = '/portal/portrait-sequence'
WHERE title ILIKE '%portrait sequence%' OR title ILIKE '%family portraits%';

-- Backfill onto existing milestones
UPDATE public.timeline_milestones tm
SET
  client_facing_label = ws.client_facing_label,
  client_facing_description = ws.client_facing_description,
  client_action_url = ws.client_action_url
FROM public.workflow_steps ws
WHERE tm.workflow_step_id = ws.id
  AND ws.client_facing_label IS NOT NULL
  AND tm.client_facing_label IS NULL;
