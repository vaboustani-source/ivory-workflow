-- ============================================================
-- 1. WORKFLOW TEMPLATES VERSIONING
-- ============================================================

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS parent_version_id uuid REFERENCES public.workflow_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS draft_changelog text;

-- Mark existing active template as published
UPDATE public.workflow_templates
SET status = 'published',
    published_at = COALESCE(published_at, created_at),
    published_by = COALESCE(published_by, (SELECT id FROM public.profiles WHERE role = 'owner' ORDER BY created_at LIMIT 1))
WHERE is_active = true AND status = 'draft';

-- Partial unique indexes to enforce: at most 1 draft & 1 published-active per name
CREATE UNIQUE INDEX IF NOT EXISTS workflow_templates_one_draft_per_name
  ON public.workflow_templates(name) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS workflow_templates_one_published_active_per_name
  ON public.workflow_templates(name) WHERE status = 'published' AND is_active = true;

-- ============================================================
-- 2. EMAIL TEMPLATES EXTENSIONS
-- ============================================================

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS preview_data jsonb;

-- ============================================================
-- 3. WORKFLOW VERSIONING FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_draft_from_published()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_published public.workflow_templates%ROWTYPE;
  v_existing_draft uuid;
  v_new_id uuid;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can edit the workflow';
  END IF;

  SELECT * INTO v_published
  FROM public.workflow_templates
  WHERE status = 'published' AND is_active = true
  ORDER BY version DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No published workflow template found';
  END IF;

  SELECT id INTO v_existing_draft
  FROM public.workflow_templates
  WHERE status = 'draft' AND name = v_published.name
  LIMIT 1;

  IF v_existing_draft IS NOT NULL THEN
    RETURN v_existing_draft;
  END IF;

  INSERT INTO public.workflow_templates (name, version, parent_version_id, status, is_active, created_by)
  VALUES (v_published.name, v_published.version + 1, v_published.id, 'draft', false, auth.uid())
  RETURNING id INTO v_new_id;

  INSERT INTO public.workflow_steps (
    workflow_template_id, step_number, stage, title, description,
    trigger_type, trigger_relative_to, trigger_offset_days, trigger_uses_business_days, trigger_event,
    responsible_party, action_type, branch_dependency, is_client_visible,
    email_template_id, questionnaire_template_id, order_in_stage, reminder_offset_days
  )
  SELECT
    v_new_id, step_number, stage, title, description,
    trigger_type, trigger_relative_to, trigger_offset_days, trigger_uses_business_days, trigger_event,
    responsible_party, action_type, branch_dependency, is_client_visible,
    email_template_id, questionnaire_template_id, order_in_stage, reminder_offset_days
  FROM public.workflow_steps
  WHERE workflow_template_id = v_published.id;

  PERFORM public._log_activity('workflow_draft_created', 'workflow_template', v_new_id,
    'Created draft v' || (v_published.version + 1), auth.uid(),
    jsonb_build_object('parent_version_id', v_published.id));

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_draft(_draft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.workflow_templates%ROWTYPE;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can discard drafts';
  END IF;

  SELECT * INTO v_draft FROM public.workflow_templates WHERE id = _draft_id;
  IF NOT FOUND OR v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'Not a draft';
  END IF;

  DELETE FROM public.workflow_steps WHERE workflow_template_id = _draft_id;
  DELETE FROM public.workflow_templates WHERE id = _draft_id;

  PERFORM public._log_activity('workflow_draft_discarded', 'workflow_template', _draft_id,
    'Discarded draft v' || v_draft.version, auth.uid(), '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_publish_impact(_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.workflow_templates%ROWTYPE;
  v_published public.workflow_templates%ROWTYPE;
  v_added jsonb;
  v_removed jsonb;
  v_changed jsonb;
  v_unchanged_count int;
  v_couples int;
  v_milestones int;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can preview publish';
  END IF;

  SELECT * INTO v_draft FROM public.workflow_templates WHERE id = _draft_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;

  SELECT * INTO v_published FROM public.workflow_templates
    WHERE status = 'published' AND is_active = true AND name = v_draft.name
    ORDER BY version DESC LIMIT 1;

  -- Steps in draft not in published (by title)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'stage', d.stage)), '[]'::jsonb)
  INTO v_added
  FROM public.workflow_steps d
  WHERE d.workflow_template_id = _draft_id
    AND NOT EXISTS (SELECT 1 FROM public.workflow_steps p WHERE p.workflow_template_id = v_published.id AND p.title = d.title);

  -- Steps in published not in draft
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'stage', p.stage)), '[]'::jsonb)
  INTO v_removed
  FROM public.workflow_steps p
  WHERE p.workflow_template_id = v_published.id
    AND NOT EXISTS (SELECT 1 FROM public.workflow_steps d WHERE d.workflow_template_id = _draft_id AND d.title = p.title);

  -- Steps in both, but different
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'stage', d.stage,
    'old', jsonb_build_object('trigger_offset_days', p.trigger_offset_days, 'trigger_relative_to', p.trigger_relative_to,
      'description', p.description, 'branch_dependency', p.branch_dependency, 'is_client_visible', p.is_client_visible,
      'action_type', p.action_type, 'responsible_party', p.responsible_party),
    'new', jsonb_build_object('trigger_offset_days', d.trigger_offset_days, 'trigger_relative_to', d.trigger_relative_to,
      'description', d.description, 'branch_dependency', d.branch_dependency, 'is_client_visible', d.is_client_visible,
      'action_type', d.action_type, 'responsible_party', d.responsible_party)
  )), '[]'::jsonb)
  INTO v_changed
  FROM public.workflow_steps d
  JOIN public.workflow_steps p ON p.workflow_template_id = v_published.id AND p.title = d.title
  WHERE d.workflow_template_id = _draft_id
    AND (d.trigger_offset_days IS DISTINCT FROM p.trigger_offset_days
      OR d.trigger_relative_to IS DISTINCT FROM p.trigger_relative_to
      OR d.description IS DISTINCT FROM p.description
      OR d.branch_dependency IS DISTINCT FROM p.branch_dependency
      OR d.is_client_visible IS DISTINCT FROM p.is_client_visible
      OR d.action_type IS DISTINCT FROM p.action_type
      OR d.responsible_party IS DISTINCT FROM p.responsible_party
      OR d.trigger_event IS DISTINCT FROM p.trigger_event
      OR d.email_template_id IS DISTINCT FROM p.email_template_id);

  SELECT COUNT(*) INTO v_unchanged_count
  FROM public.workflow_steps d
  JOIN public.workflow_steps p ON p.workflow_template_id = v_published.id AND p.title = d.title
  WHERE d.workflow_template_id = _draft_id
    AND d.trigger_offset_days IS NOT DISTINCT FROM p.trigger_offset_days
    AND d.trigger_relative_to IS NOT DISTINCT FROM p.trigger_relative_to
    AND d.description IS NOT DISTINCT FROM p.description
    AND d.branch_dependency IS NOT DISTINCT FROM p.branch_dependency
    AND d.is_client_visible IS NOT DISTINCT FROM p.is_client_visible
    AND d.action_type IS NOT DISTINCT FROM p.action_type
    AND d.responsible_party IS NOT DISTINCT FROM p.responsible_party;

  SELECT COUNT(*) INTO v_couples FROM public.clients WHERE status IN ('booked','active');

  SELECT COUNT(*) INTO v_milestones
  FROM public.timeline_milestones m
  JOIN public.clients c ON c.id = m.client_id
  WHERE c.status IN ('booked','active') AND m.status = 'upcoming';

  RETURN jsonb_build_object(
    'steps', jsonb_build_object(
      'added', v_added,
      'removed', v_removed,
      'changed', v_changed,
      'unchanged_count', v_unchanged_count
    ),
    'couples_affected', v_couples,
    'milestones_affected', v_milestones,
    'new_version', v_draft.version,
    'archived_version', v_published.version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_draft(_draft_id uuid, _migrate_couples boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.workflow_templates%ROWTYPE;
  v_old_published public.workflow_templates%ROWTYPE;
  v_client RECORD;
  v_milestone RECORD;
  v_new_step public.workflow_steps%ROWTYPE;
  v_migrated_couples int := 0;
  v_migrated_ms int := 0;
  v_skipped_ms int := 0;
  v_created_ms int := 0;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can publish the workflow';
  END IF;

  SELECT * INTO v_draft FROM public.workflow_templates WHERE id = _draft_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;

  SELECT * INTO v_old_published FROM public.workflow_templates
    WHERE status = 'published' AND is_active = true AND name = v_draft.name
    ORDER BY version DESC LIMIT 1;

  -- Archive old, publish new (drop the partial-unique invariant by toggling old first)
  IF FOUND THEN
    UPDATE public.workflow_templates
    SET status = 'archived', is_active = false
    WHERE id = v_old_published.id;
  END IF;

  UPDATE public.workflow_templates
  SET status = 'published', is_active = true,
      published_at = now(), published_by = auth.uid()
  WHERE id = _draft_id;

  IF _migrate_couples AND v_old_published.id IS NOT NULL THEN
    FOR v_client IN
      SELECT * FROM public.clients WHERE status IN ('booked','active')
    LOOP
      v_migrated_couples := v_migrated_couples + 1;

      -- Walk upcoming milestones, match by title to new template's steps
      FOR v_milestone IN
        SELECT m.* FROM public.timeline_milestones m
        WHERE m.client_id = v_client.id AND m.status = 'upcoming'
      LOOP
        SELECT * INTO v_new_step FROM public.workflow_steps
          WHERE workflow_template_id = _draft_id AND title = v_milestone.title
          LIMIT 1;

        IF FOUND THEN
          UPDATE public.timeline_milestones
          SET title = v_new_step.title,
              description = v_new_step.description,
              is_client_visible = v_new_step.is_client_visible,
              action_type = v_new_step.action_type::text,
              responsible_party = v_new_step.responsible_party::text,
              stage = v_new_step.stage,
              workflow_step_id = v_new_step.id
          WHERE id = v_milestone.id;
          v_migrated_ms := v_migrated_ms + 1;
        ELSE
          UPDATE public.timeline_milestones
          SET status = 'skipped',
              override_reason = 'Removed in template v' || v_draft.version,
              is_overridden = true
          WHERE id = v_milestone.id;
          v_skipped_ms := v_skipped_ms + 1;
        END IF;
      END LOOP;

      -- Re-materialize: any new steps whose anchor is in the future
      PERFORM public.materialize_workflow_for_client(v_client.id);
      GET DIAGNOSTICS v_created_ms = ROW_COUNT; -- best-effort; materialize logs actual count
    END LOOP;
  END IF;

  PERFORM public._log_activity('workflow_published', 'workflow_template', _draft_id,
    'Published v' || v_draft.version,
    auth.uid(),
    jsonb_build_object(
      'version', v_draft.version,
      'archived_version', v_old_published.version,
      'migrate_couples', _migrate_couples,
      'migrated_couples', v_migrated_couples,
      'migrated_milestones', v_migrated_ms,
      'skipped_milestones', v_skipped_ms,
      'changelog', v_draft.draft_changelog
    ));

  RETURN jsonb_build_object(
    'version', v_draft.version,
    'archived_version', v_old_published.version,
    'migrated_couples', v_migrated_couples,
    'migrated_milestones', v_migrated_ms,
    'skipped_milestones', v_skipped_ms,
    'created_milestones', v_created_ms
  );
END;
$$;

-- ============================================================
-- 4. MERGE FIELD SUBSTITUTION
-- ============================================================

CREATE OR REPLACE FUNCTION public._substitute_merge_fields(_client_id uuid, _text text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_photographer text;
  v_first_names text;
  v_full_names text;
  v_wd_long text;
  v_wd_short text;
  v_days_until text;
  v_result text := COALESCE(_text, '');
BEGIN
  IF _text IS NULL OR _client_id IS NULL THEN RETURN _text; END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = _client_id;
  IF NOT FOUND THEN RETURN _text; END IF;

  SELECT full_name INTO v_photographer FROM public.profiles WHERE id = v_client.photographer_id;

  v_first_names := split_part(v_client.couple_name_1, ' ', 1)
    || COALESCE(' & ' || split_part(v_client.couple_name_2, ' ', 1), '');
  v_full_names := v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2, '');

  IF v_client.wedding_date IS NOT NULL THEN
    v_wd_long := to_char(v_client.wedding_date, 'FMDay, FMMonth FMDD, YYYY');
    v_wd_short := to_char(v_client.wedding_date, 'Mon FMDD, YYYY');
    v_days_until := (v_client.wedding_date - CURRENT_DATE)::text;
  ELSE
    v_wd_long := 'TBD'; v_wd_short := 'TBD'; v_days_until := 'TBD';
  END IF;

  v_result := replace(v_result, '{couple_first_names}', v_first_names);
  v_result := replace(v_result, '{couple_full_names}', v_full_names);
  v_result := replace(v_result, '{wedding_date_long}', v_wd_long);
  v_result := replace(v_result, '{wedding_date_short}', v_wd_short);
  v_result := replace(v_result, '{days_until_wedding}', v_days_until);
  v_result := replace(v_result, '{venue_name}', COALESCE(v_client.venue_name, 'your venue'));
  v_result := replace(v_result, '{photographer_name}', COALESCE(v_photographer, 'Victoria'));
  v_result := replace(v_result, '{studio_email}', 'hello@storiesbyvictoria.com');
  v_result := replace(v_result, '{studio_signature}', 'with care, Stories by Victoria');
  v_result := replace(v_result, '{portal_url}', '(portal link)');
  v_result := replace(v_result, '{logistics_form_url}', '(logistics form link)');
  v_result := replace(v_result, '{gallery_url}', '(gallery link)');
  v_result := replace(v_result, '{sneak_peek_url}', '(sneak peek link)');

  RETURN v_result;
END;
$$;

-- Update _draft_scheduled_communication to use templates with merge substitution
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
BEGIN
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
    v_body := '[PLACEHOLDER COPY — to be written. This email fires for: ' || COALESCE(v_milestone.title,'') ||
      '. Workflow stage: ' || COALESCE(v_milestone.stage, COALESCE(v_step.stage,'')) ||
      '. Client: ' || v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2,'') ||
      '. Wedding date: ' || COALESCE(v_client.wedding_date::text,'TBD') || '.]';
  END IF;

  INSERT INTO public.scheduled_communications (
    client_id, milestone_id, workflow_step_id, email_template_id,
    subject, body_draft, status, scheduled_send_at, recipient_emails
  ) VALUES (
    v_milestone.client_id, p_milestone_id, v_milestone.workflow_step_id, v_step.email_template_id,
    v_subject, v_body, 'awaiting_approval', v_send_at, v_recipients
  );
END;
$$;

-- ============================================================
-- 5. SEED 12 EMAIL TEMPLATES
-- ============================================================

INSERT INTO public.email_templates (name, stage, subject, body, merge_fields, description, requires_approval, is_active)
VALUES
('Inquiry — first response', 'inquiry',
 'Thank you for reaching out, {couple_first_names}',
 E'Hi {couple_first_names},\n\nThank you so much for thinking of me for your wedding. I''d love to learn more about your day.\n\nI''ve attached a link to my portal where you can browse recent weddings and see my full pricing: {portal_url}\n\nWhen would be a good time for a quick call this week?\n\n{studio_signature}',
 '[{"field":"couple_first_names","desc":"Couple''s first names"},{"field":"portal_url","desc":"Inquiry portal link"},{"field":"studio_signature","desc":"Studio sign-off"}]'::jsonb,
 'First reply to an inquiry, sent within 24 hours', true, true),

('Welcome — booked couple', 'welcome',
 'Welcome to your story, {couple_first_names}',
 E'{couple_first_names},\n\nWelcome — I''m so glad you''re here. Your wedding on {wedding_date_long} is officially on my calendar, and I cannot wait.\n\nYour portal is your home base from here on out: {portal_url}\n\nI''ll be in touch in the coming weeks with next steps. In the meantime, write me anytime at {studio_email}.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"wedding_date_long"},{"field":"portal_url"},{"field":"studio_email"}]'::jsonb,
 'Sent immediately after retainer + contract complete', true, true),

('Engagement — schedule your session', 'engagement',
 'Let''s plan your engagement session, {couple_first_names}',
 E'Hi {couple_first_names},\n\nIt''s time to start thinking about your engagement session. I''d love to hear what locations or moods feel like *you*.\n\nReply to this email or book a planning call from your portal: {portal_url}\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"portal_url"}]'::jsonb,
 'Sent ~90 days before wedding for couples with engagement sessions', true, true),

('Engagement — gallery delivered', 'engagement',
 'Your engagement gallery is ready ✨',
 E'{couple_first_names},\n\nYour engagement gallery is live — see it here: {gallery_url}\n\nTake your time. Save your favorites. Share them with the people who love you most.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"gallery_url"}]'::jsonb,
 'Sent when engagement gallery is delivered', true, true),

('Pre-wedding — logistics check-in', 'pre_wedding',
 'Wedding logistics, {wedding_date_short}',
 E'Hi {couple_first_names},\n\n{days_until_wedding} days to go. Time to get into the details.\n\nPlease fill out your logistics form when you have 20 quiet minutes: {logistics_form_url}\n\nThis is what helps me show up on the day with no surprises and full attention on you.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"wedding_date_short"},{"field":"days_until_wedding"},{"field":"logistics_form_url"}]'::jsonb,
 'Sent ~8 weeks before wedding', true, true),

('Pre-wedding — final timeline', 'pre_wedding',
 'Your final wedding day timeline',
 E'{couple_first_names},\n\nYour timeline for {wedding_date_long} is locked in and attached to your portal: {portal_url}\n\nI''ll see you at {venue_name}. Take a deep breath — you''re in good hands.\n\n{photographer_name}\n{studio_signature}',
 '[{"field":"wedding_date_long"},{"field":"venue_name"},{"field":"photographer_name"},{"field":"portal_url"}]'::jsonb,
 'Sent 2 weeks before wedding with finalized timeline', true, true),

('Wedding week — final note', 'pre_wedding',
 'See you {wedding_date_short}',
 E'{couple_first_names},\n\nIt''s wedding week. I''m thinking of you both.\n\nA few last reminders are in your portal: {portal_url}\n\nRest. Hydrate. Trust the day. I''ll be there with cameras ready and a calm heart.\n\n{photographer_name}',
 '[{"field":"couple_first_names"},{"field":"wedding_date_short"},{"field":"portal_url"},{"field":"photographer_name"}]'::jsonb,
 'Sent the Monday of wedding week', true, true),

('Post-wedding — sneak peek', 'post_wedding',
 'A first look at your wedding ✨',
 E'{couple_first_names},\n\nI couldn''t wait to send you these. Here''s a sneak peek from {wedding_date_long}: {sneak_peek_url}\n\nThe full gallery is in editing now and will be with you within the timeline we discussed.\n\nThank you for letting me be there.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"wedding_date_long"},{"field":"sneak_peek_url"}]'::jsonb,
 'Sent within 72 hours of the wedding', true, true),

('Post-wedding — full gallery', 'post_wedding',
 'Your wedding gallery is here',
 E'{couple_first_names},\n\nIt''s time. Your full wedding gallery is live: {gallery_url}\n\nThis is your story, told in full. Pour something nice and take it slowly.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"gallery_url"}]'::jsonb,
 'Sent when full wedding gallery is delivered', true, true),

('Album — design kickoff', 'album',
 'Let''s build your album',
 E'{couple_first_names},\n\nReady to start designing your album? I''ve put together a short questionnaire to gather your favorites and preferences: {portal_url}\n\nOnce you''re done, I''ll come back with a first proof within two weeks.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"portal_url"}]'::jsonb,
 'Sent when album workflow is activated', true, true),

('Album — proof ready', 'album',
 'Your album proof is ready to review',
 E'{couple_first_names},\n\nYour album proof is in your portal — take a look here: {portal_url}\n\nYou get two rounds of revisions, so don''t be shy. Let me know what you''d like to change, or give me the green light to send to print.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"portal_url"}]'::jsonb,
 'Sent when album proof is ready for client review', true, true),

('Long tail — anniversary', 'long_tail',
 'Happy anniversary, {couple_first_names}',
 E'{couple_first_names},\n\nOne year ago today. Hard to believe.\n\nIf you ever want to revisit your gallery, it lives here: {gallery_url}\n\nWishing you a beautiful year ahead.\n\n{studio_signature}',
 '[{"field":"couple_first_names"},{"field":"gallery_url"}]'::jsonb,
 'Sent on the 1-year wedding anniversary', false, true);
