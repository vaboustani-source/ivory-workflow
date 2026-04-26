
-- =========================================================
-- ACTIVITY LOG HELPER
-- =========================================================
CREATE OR REPLACE FUNCTION public._log_activity(
  p_action_type text,
  p_target_type text,
  p_target_id uuid,
  p_description text,
  p_user_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_log (action_type, target_type, target_id, description, user_id, metadata)
  VALUES (p_action_type, p_target_type, p_target_id, p_description, p_user_id, COALESCE(p_metadata,'{}'::jsonb));
END;
$$;

-- =========================================================
-- ANCHOR DATE RESOLVER
-- =========================================================
CREATE OR REPLACE FUNCTION public._anchor_date(p_client_id uuid, p_anchor text, p_step_id uuid DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_client public.clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  CASE p_anchor
    WHEN 'wedding_date' THEN
      v_date := v_client.wedding_date;
    WHEN 'booking_date' THEN
      v_date := COALESCE(v_client.booked_at::date, v_client.created_at::date);
    WHEN 'engagement_session_date' THEN
      SELECT MIN(scheduled_at)::date INTO v_date
        FROM public.engagement_sessions
        WHERE client_id = p_client_id AND scheduled_at IS NOT NULL;
    WHEN 'gallery_delivery_date' THEN
      SELECT MIN(delivered_at)::date INTO v_date
        FROM public.galleries
        WHERE client_id = p_client_id AND delivered_at IS NOT NULL;
    WHEN 'album_workflow_activated_at' THEN
      v_date := v_client.album_workflow_activated_at::date;
    WHEN 'proposal_valid_until' THEN
      SELECT MAX(valid_until) INTO v_date
        FROM public.proposals
        WHERE client_id = p_client_id;
    WHEN 'previous_step' THEN
      -- Best-effort: most-recent prior milestone's completed_at or due_date
      SELECT COALESCE(completed_at::date, due_date) INTO v_date
        FROM public.timeline_milestones
        WHERE client_id = p_client_id
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT 1;
      IF v_date IS NULL THEN
        v_date := COALESCE(v_client.booked_at::date, v_client.created_at::date);
      END IF;
    ELSE
      v_date := NULL;
  END CASE;

  RETURN v_date;
END;
$$;

-- =========================================================
-- SCHEDULED COMMUNICATION DRAFT
-- =========================================================
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
  v_recipients text[];
  v_send_at timestamptz;
  v_existing uuid;
BEGIN
  SELECT * INTO v_milestone FROM public.timeline_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_milestone.client_id;
  IF v_milestone.workflow_step_id IS NOT NULL THEN
    SELECT * INTO v_step FROM public.workflow_steps WHERE id = v_milestone.workflow_step_id;
  END IF;

  -- Skip if already exists for this milestone
  SELECT id INTO v_existing FROM public.scheduled_communications WHERE milestone_id = p_milestone_id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN; END IF;

  v_recipients := ARRAY[v_client.primary_email];
  IF v_client.secondary_email IS NOT NULL AND length(trim(v_client.secondary_email)) > 0 THEN
    v_recipients := v_recipients || v_client.secondary_email;
  END IF;

  -- 9am ET = 13:00 UTC (DST-naive, fine for placeholder drafts)
  v_send_at := CASE
    WHEN v_milestone.due_date IS NOT NULL THEN (v_milestone.due_date::timestamp + interval '13 hours') AT TIME ZONE 'UTC'
    ELSE NULL
  END;

  INSERT INTO public.scheduled_communications (
    client_id, milestone_id, workflow_step_id, email_template_id,
    subject, body_draft, status, scheduled_send_at, recipient_emails
  ) VALUES (
    v_milestone.client_id,
    p_milestone_id,
    v_milestone.workflow_step_id,
    v_step.email_template_id,
    '[PLACEHOLDER] ' || COALESCE(v_milestone.title, 'Untitled'),
    '[PLACEHOLDER COPY — to be written. This email fires for: ' || COALESCE(v_milestone.title,'') ||
      '. Workflow stage: ' || COALESCE(v_milestone.stage, COALESCE(v_step.stage,'')) ||
      '. Client: ' || v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2,'') ||
      '. Wedding date: ' || COALESCE(v_client.wedding_date::text,'TBD') || '.]',
    'awaiting_approval',
    v_send_at,
    v_recipients
  );
END;
$$;

-- =========================================================
-- BRANCH GATE
-- =========================================================
CREATE OR REPLACE FUNCTION public._branch_passes(p_branch public.workflow_branch, p_client public.clients) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_branch
    WHEN 'always' THEN true
    WHEN 'has_engagement' THEN COALESCE(p_client.has_engagement,false)
    WHEN 'has_videography' THEN COALESCE(p_client.has_videography,false)
    WHEN 'has_album' THEN COALESCE(p_client.has_album,false)
    WHEN 'has_album_active' THEN COALESCE(p_client.album_workflow_active,false)
    WHEN 'NOT_has_album_purchased' THEN NOT COALESCE(p_client.has_album,false)
    ELSE false
  END;
END; $$;

-- =========================================================
-- materialize_workflow_for_client
-- =========================================================
CREATE OR REPLACE FUNCTION public.materialize_workflow_for_client(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Branch gate
    IF NOT public._branch_passes(v_step.branch_dependency, v_client) THEN
      CONTINUE;
    END IF;

    -- Skip if already materialized
    IF EXISTS (
      SELECT 1 FROM public.timeline_milestones
      WHERE client_id = p_client_id AND workflow_step_id = v_step.id
    ) THEN
      CONTINUE;
    END IF;

    -- Skip event-triggered steps; they are created by trigger_event_handler
    IF v_step.trigger_type = 'event' THEN
      CONTINUE;
    END IF;

    -- Manual triggers: create with NULL due date
    IF v_step.trigger_type = 'manual' THEN
      v_due := NULL;
    ELSE
      v_anchor := public._anchor_date(p_client_id, v_step.trigger_relative_to::text, v_step.id);
      IF v_anchor IS NULL THEN
        -- Anchor not available yet; skip (will materialize later when anchor exists)
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
      action_type, responsible_party, stage
    ) VALUES (
      p_client_id, v_step.id, v_step.title, v_step.description, v_due,
      'upcoming', v_step.is_client_visible, false,
      v_step.action_type::text, v_step.responsible_party::text, v_step.stage
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
$$;

-- =========================================================
-- trigger_event_handler
-- =========================================================
CREATE OR REPLACE FUNCTION public.trigger_event_handler(
  p_client_id uuid, p_event_name text, p_event_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      action_type, responsible_party, stage, metadata
    ) VALUES (
      p_client_id, v_step.id, v_step.title, v_step.description, CURRENT_DATE,
      'upcoming', v_step.is_client_visible, false,
      v_step.action_type::text, v_step.responsible_party::text, v_step.stage,
      COALESCE(p_event_metadata,'{}'::jsonb)
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

  -- Always re-run materialization (newly satisfied anchors may unlock more steps)
  PERFORM public.materialize_workflow_for_client(p_client_id);
END;
$$;

-- =========================================================
-- recalculate_milestones_for_client
-- =========================================================
CREATE OR REPLACE FUNCTION public.recalculate_milestones_for_client(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_milestone RECORD;
  v_step public.workflow_steps%ROWTYPE;
  v_anchor date;
  v_new_due date;
  v_old_due date;
BEGIN
  FOR v_milestone IN
    SELECT m.* FROM public.timeline_milestones m
    WHERE m.client_id = p_client_id AND m.status = 'upcoming' AND m.workflow_step_id IS NOT NULL
  LOOP
    SELECT * INTO v_step FROM public.workflow_steps WHERE id = v_milestone.workflow_step_id;
    IF NOT FOUND OR v_step.trigger_type <> 'relative_date' THEN CONTINUE; END IF;

    v_anchor := public._anchor_date(p_client_id, v_step.trigger_relative_to::text, v_step.id);
    IF v_anchor IS NULL THEN CONTINUE; END IF;

    IF v_step.trigger_uses_business_days THEN
      v_new_due := public.add_business_days(v_anchor, COALESCE(v_step.trigger_offset_days,0));
    ELSE
      v_new_due := v_anchor + COALESCE(v_step.trigger_offset_days,0);
    END IF;

    v_old_due := v_milestone.due_date;
    IF v_new_due IS DISTINCT FROM v_old_due THEN
      UPDATE public.timeline_milestones SET due_date = v_new_due WHERE id = v_milestone.id;

      -- Cascade to scheduled comm
      UPDATE public.scheduled_communications
        SET scheduled_send_at = (v_new_due::timestamp + interval '13 hours') AT TIME ZONE 'UTC'
        WHERE milestone_id = v_milestone.id AND status = 'awaiting_approval';

      PERFORM public._log_activity(
        'milestone_shifted','milestone',v_milestone.id,
        'Shifted "' || v_milestone.title || '" from ' || COALESCE(v_old_due::text,'—') || ' to ' || v_new_due::text,
        auth.uid(),
        jsonb_build_object('client_id', p_client_id, 'old_due', v_old_due, 'new_due', v_new_due)
      );
    END IF;
  END LOOP;
END;
$$;

-- =========================================================
-- TRIGGERS
-- =========================================================

-- clients.status changes
CREATE OR REPLACE FUNCTION public._trg_clients_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'booked' AND (OLD.status IS NULL OR OLD.status <> 'booked') THEN
      IF NEW.booked_at IS NULL THEN
        NEW.booked_at := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_clients_status_change_before ON public.clients;
CREATE TRIGGER trg_clients_status_change_before
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_status_change();

CREATE OR REPLACE FUNCTION public._trg_clients_status_change_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'booked' AND (OLD.status IS NULL OR OLD.status <> 'booked') THEN
    PERFORM public._log_activity('status_change','client',NEW.id,
      'Client status: ' || COALESCE(OLD.status::text,'—') || ' → booked',
      auth.uid(), '{}'::jsonb);
    PERFORM public.trigger_event_handler(NEW.id, 'booked', '{}'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_clients_status_change_after ON public.clients;
CREATE TRIGGER trg_clients_status_change_after
  AFTER UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_status_change_after();

-- clients.wedding_date changes
CREATE OR REPLACE FUNCTION public._trg_clients_wedding_date_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.wedding_date IS DISTINCT FROM OLD.wedding_date THEN
    PERFORM public._log_activity('wedding_date_changed','client',NEW.id,
      'Wedding date: ' || COALESCE(OLD.wedding_date::text,'—') || ' → ' || COALESCE(NEW.wedding_date::text,'—'),
      auth.uid(), '{}'::jsonb);
    PERFORM public.recalculate_milestones_for_client(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_clients_wedding_date_change ON public.clients;
CREATE TRIGGER trg_clients_wedding_date_change
  AFTER UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_wedding_date_change();

-- clients.album_workflow_active flips on
CREATE OR REPLACE FUNCTION public._trg_clients_album_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.album_workflow_active = true AND COALESCE(OLD.album_workflow_active,false) = false THEN
    NEW.album_workflow_activated_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_clients_album_active_before ON public.clients;
CREATE TRIGGER trg_clients_album_active_before
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_album_active();

CREATE OR REPLACE FUNCTION public._trg_clients_album_active_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.album_workflow_active = true AND COALESCE(OLD.album_workflow_active,false) = false THEN
    PERFORM public._log_activity('album_workflow_activated','client',NEW.id,
      'Album workflow activated', auth.uid(), '{}'::jsonb);
    PERFORM public.trigger_event_handler(NEW.id, 'album_workflow_activated', '{}'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_clients_album_active_after ON public.clients;
CREATE TRIGGER trg_clients_album_active_after
  AFTER UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_clients_album_active_after();

-- contracts.status → contract_signed; auto-flip booked when retainer also paid
CREATE OR REPLACE FUNCTION public._trg_contracts_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retainer_paid boolean;
  v_client_status public.client_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status::text = 'signed' AND OLD.status::text <> 'signed' AND NEW.client_id IS NOT NULL THEN
    PERFORM public.trigger_event_handler(NEW.client_id, 'contract_signed', '{}'::jsonb);

    SELECT EXISTS(
      SELECT 1 FROM public.invoices
      WHERE client_id = NEW.client_id
        AND invoice_type::text = 'retainer'
        AND status::text = 'paid'
    ) INTO v_retainer_paid;

    SELECT status INTO v_client_status FROM public.clients WHERE id = NEW.client_id;
    IF v_retainer_paid AND v_client_status::text <> 'booked' THEN
      UPDATE public.clients SET status = 'booked' WHERE id = NEW.client_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_contracts_status ON public.contracts;
CREATE TRIGGER trg_contracts_status
  AFTER UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public._trg_contracts_status();

-- invoices.status → retainer_paid; auto-flip booked when contract also signed
CREATE OR REPLACE FUNCTION public._trg_invoices_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contract_signed boolean;
  v_client_status public.client_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_type::text = 'retainer'
     AND NEW.status::text = 'paid' AND OLD.status::text <> 'paid'
     AND NEW.client_id IS NOT NULL THEN
    PERFORM public.trigger_event_handler(NEW.client_id, 'retainer_paid', '{}'::jsonb);

    SELECT EXISTS(
      SELECT 1 FROM public.contracts
      WHERE client_id = NEW.client_id AND status::text = 'signed'
    ) INTO v_contract_signed;

    SELECT status INTO v_client_status FROM public.clients WHERE id = NEW.client_id;
    IF v_contract_signed AND v_client_status::text <> 'booked' THEN
      UPDATE public.clients SET status = 'booked' WHERE id = NEW.client_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoices_status ON public.invoices;
CREATE TRIGGER trg_invoices_status
  AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_invoices_status();

-- proposals.status → proposal_sent / proposal_accepted
CREATE OR REPLACE FUNCTION public._trg_proposals_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status::text IS DISTINCT FROM OLD.status::text AND NEW.client_id IS NOT NULL THEN
    IF NEW.status::text = 'sent' THEN
      PERFORM public.trigger_event_handler(NEW.client_id, 'proposal_sent', '{}'::jsonb);
    ELSIF NEW.status::text = 'accepted' THEN
      PERFORM public.trigger_event_handler(NEW.client_id, 'proposal_accepted', '{}'::jsonb);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_proposals_status ON public.proposals;
CREATE TRIGGER trg_proposals_status
  AFTER UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public._trg_proposals_status();

-- engagement_sessions.scheduled_at first set
CREATE OR REPLACE FUNCTION public._trg_engagement_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scheduled_at IS NOT NULL AND OLD.scheduled_at IS NULL AND NEW.client_id IS NOT NULL THEN
    PERFORM public.trigger_event_handler(NEW.client_id, 'engagement_session_scheduled', '{}'::jsonb);
    -- Newly resolved anchor → re-run materialization
    PERFORM public.materialize_workflow_for_client(NEW.client_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_engagement_scheduled ON public.engagement_sessions;
CREATE TRIGGER trg_engagement_scheduled
  AFTER UPDATE ON public.engagement_sessions
  FOR EACH ROW EXECUTE FUNCTION public._trg_engagement_scheduled();
