
ALTER TABLE public.studio_settings
  ADD COLUMN IF NOT EXISTS workflow_comms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_comms_auto_approve boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sched_comm_milestone
  ON public.scheduled_communications(milestone_id)
  WHERE milestone_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._draft_scheduled_communication(p_milestone_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_milestone public.timeline_milestones%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_step public.workflow_steps%ROWTYPE;
  v_template public.email_templates%ROWTYPE;
  v_recipients text[];
  v_send_at timestamptz;
  v_existing uuid;
  v_subject text;
  v_body text;
  v_enabled boolean;
  v_auto boolean;
  v_status communication_status;
BEGIN
  SELECT workflow_comms_enabled, workflow_comms_auto_approve
    INTO v_enabled, v_auto
  FROM public.studio_settings
  WHERE is_active = true
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN;
  END IF;

  SELECT * INTO v_milestone FROM public.timeline_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_milestone.client_id;
  IF v_milestone.workflow_step_id IS NOT NULL THEN
    SELECT * INTO v_step FROM public.workflow_steps WHERE id = v_milestone.workflow_step_id;
  END IF;

  SELECT id INTO v_existing FROM public.scheduled_communications WHERE milestone_id = p_milestone_id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN; END IF;

  v_recipients := ARRAY[v_client.primary_email];
  IF v_client.secondary_email IS NOT NULL AND length(trim(v_client.secondary_email)) > 0 THEN
    v_recipients := v_recipients || v_client.secondary_email;
  END IF;

  v_send_at := CASE
    WHEN v_milestone.due_date IS NOT NULL THEN (v_milestone.due_date::timestamp + interval '13 hours') AT TIME ZONE 'UTC'
    ELSE NULL
  END;

  IF v_step.email_template_id IS NOT NULL THEN
    SELECT * INTO v_template FROM public.email_templates WHERE id = v_step.email_template_id;
    IF FOUND THEN
      v_subject := public._substitute_merge_fields(v_client.id, v_template.subject);
      v_body := public._substitute_merge_fields(v_client.id, v_template.body);
    END IF;
  END IF;

  IF v_subject IS NULL THEN
    v_subject := '[PLACEHOLDER] ' || COALESCE(v_milestone.title, 'Untitled');
    v_body := '[PLACEHOLDER COPY] This email fires for: ' || COALESCE(v_milestone.title,'') ||
      '. Workflow stage: ' || COALESCE(v_milestone.stage, COALESCE(v_step.stage,'')) ||
      '. Client: ' || v_client.couple_name_1 || COALESCE(' and ' || v_client.couple_name_2,'') ||
      '. Wedding date: ' || COALESCE(v_client.wedding_date::text,'TBD') || '.';
  END IF;

  IF COALESCE(v_auto, false) THEN
    v_status := 'approved'::communication_status;
  ELSE
    v_status := 'awaiting_approval'::communication_status;
  END IF;

  INSERT INTO public.scheduled_communications (
    client_id, milestone_id, workflow_step_id, email_template_id,
    subject, body_draft, status, scheduled_send_at, recipient_emails,
    approved_at
  ) VALUES (
    v_milestone.client_id, p_milestone_id, v_milestone.workflow_step_id, v_step.email_template_id,
    v_subject, v_body, v_status, v_send_at, v_recipients,
    CASE WHEN v_status = 'approved' THEN now() ELSE NULL END
  )
  ON CONFLICT (milestone_id) WHERE milestone_id IS NOT NULL DO NOTHING;
END;
$$;
