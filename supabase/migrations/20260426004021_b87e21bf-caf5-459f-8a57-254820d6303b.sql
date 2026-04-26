
-- =========================================================
-- TABLES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.business_calendar_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date UNIQUE NOT NULL,
  name text NOT NULL,
  is_observed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_calendar_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio manages holidays" ON public.business_calendar_holidays;
CREATE POLICY "Studio manages holidays" ON public.business_calendar_holidays
  FOR ALL USING (public.is_studio_user(auth.uid()));

DROP POLICY IF EXISTS "Authenticated reads holidays" ON public.business_calendar_holidays;
CREATE POLICY "Authenticated reads holidays" ON public.business_calendar_holidays
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.workflow_step_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_step_id uuid NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
  branch_type public.workflow_branch NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_step_id, branch_type)
);

ALTER TABLE public.workflow_step_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio manages workflow_step_branches" ON public.workflow_step_branches;
CREATE POLICY "Studio manages workflow_step_branches" ON public.workflow_step_branches
  FOR ALL USING (public.is_studio_user(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_calendar_holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_step_branches TO authenticated;

-- =========================================================
-- ALTER existing tables
-- =========================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS album_workflow_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS album_workflow_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS booked_at timestamptz;

ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS trigger_uses_business_days boolean NOT NULL DEFAULT false;

ALTER TABLE public.timeline_milestones
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS responsible_party text,
  ADD COLUMN IF NOT EXISTS stage text;

ALTER TABLE public.scheduled_communications
  ADD COLUMN IF NOT EXISTS workflow_step_id uuid;

CREATE INDEX IF NOT EXISTS idx_milestones_client ON public.timeline_milestones(client_id);
CREATE INDEX IF NOT EXISTS idx_milestones_step ON public.timeline_milestones(workflow_step_id);
CREATE INDEX IF NOT EXISTS idx_sched_comm_client ON public.scheduled_communications(client_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_event ON public.workflow_steps(trigger_event);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_template ON public.workflow_steps(workflow_template_id);

-- =========================================================
-- add_business_days FUNCTION
-- =========================================================
CREATE OR REPLACE FUNCTION public.add_business_days(start_date date, days_to_add integer)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  current_d date := start_date;
  remaining integer := days_to_add;
  step integer;
  dow integer;
  is_holiday boolean;
BEGIN
  IF days_to_add = 0 THEN
    RETURN start_date;
  END IF;
  step := CASE WHEN days_to_add > 0 THEN 1 ELSE -1 END;
  WHILE remaining <> 0 LOOP
    current_d := current_d + step;
    dow := EXTRACT(DOW FROM current_d)::int;
    IF dow = 0 OR dow = 6 THEN
      CONTINUE;
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM public.business_calendar_holidays
      WHERE holiday_date = current_d AND is_observed = true
    ) INTO is_holiday;
    IF is_holiday THEN
      CONTINUE;
    END IF;
    remaining := remaining - step;
  END LOOP;
  RETURN current_d;
END;
$$;

-- =========================================================
-- SEED HOLIDAYS 2026 + 2027
-- =========================================================
INSERT INTO public.business_calendar_holidays (holiday_date, name) VALUES
  ('2026-01-01','New Year''s Day'),
  ('2026-01-19','MLK Day'),
  ('2026-02-16','Presidents Day'),
  ('2026-05-25','Memorial Day'),
  ('2026-06-19','Juneteenth'),
  ('2026-07-04','Independence Day'),
  ('2026-09-07','Labor Day'),
  ('2026-10-12','Columbus Day'),
  ('2026-11-11','Veterans Day'),
  ('2026-11-26','Thanksgiving'),
  ('2026-11-27','Day after Thanksgiving'),
  ('2026-12-24','Christmas Eve'),
  ('2026-12-25','Christmas Day'),
  ('2026-12-31','New Year''s Eve'),
  ('2027-01-01','New Year''s Day'),
  ('2027-01-18','MLK Day'),
  ('2027-02-15','Presidents Day'),
  ('2027-05-31','Memorial Day'),
  ('2027-06-19','Juneteenth'),
  ('2027-07-04','Independence Day'),
  ('2027-09-06','Labor Day'),
  ('2027-10-11','Columbus Day'),
  ('2027-11-11','Veterans Day'),
  ('2027-11-25','Thanksgiving'),
  ('2027-11-26','Day after Thanksgiving'),
  ('2027-12-24','Christmas Eve'),
  ('2027-12-25','Christmas Day'),
  ('2027-12-31','New Year''s Eve')
ON CONFLICT (holiday_date) DO NOTHING;

-- =========================================================
-- WORKFLOW TEMPLATE + 64 STEPS
-- =========================================================
DO $seed$
DECLARE
  v_template_id uuid;
  v_owner_id uuid := '15f705ca-8003-467d-8b38-48b1795a6ba3';
BEGIN
  IF EXISTS (SELECT 1 FROM public.workflow_templates WHERE name = 'SBV Standard Wedding Journey') THEN
    RETURN;
  END IF;

  INSERT INTO public.workflow_templates (name, version, is_active, created_by)
  VALUES ('SBV Standard Wedding Journey', 1, true, v_owner_id)
  RETURNING id INTO v_template_id;

  INSERT INTO public.workflow_steps (
    workflow_template_id, step_number, stage, order_in_stage, title, description,
    trigger_type, trigger_event, trigger_offset_days, trigger_relative_to,
    trigger_uses_business_days, responsible_party, action_type,
    branch_dependency, is_client_visible, reminder_offset_days
  ) VALUES
  -- STAGE 0 — INQUIRY
  (v_template_id, 1,'inquiry',1,'Inquiry received','Inquiry submitted via portal or email','event','inquiry_received',NULL,NULL,false,'system','status_change','always',false,NULL),
  (v_template_id, 2,'inquiry',2,'Send acknowledgment + discovery call link','Auto-acknowledgment with booking link','relative_date',NULL,0,'previous_step',false,'system','draft_email','always',true,NULL),
  (v_template_id, 3,'inquiry',3,'Grant inquiry portal access','Provision the inquiry-stage portal','relative_date',NULL,0,'previous_step',false,'system','show_portal_item','always',true,NULL),
  (v_template_id, 4,'inquiry',4,'Internal: respond to inquiry within 24 hours','Personal acknowledgment from Dexter','relative_date',NULL,1,'previous_step',true,'manager','create_task','always',false,NULL),
  (v_template_id, 5,'inquiry',5,'Reminder: discovery call not yet booked','Nudge if no call on calendar','relative_date',NULL,3,'previous_step',true,'system','draft_email','always',true,3),
  (v_template_id, 6,'inquiry',6,'Discovery call held','Discovery call completed','event','discovery_call_complete',NULL,NULL,false,'owner','status_change','always',false,NULL),
  (v_template_id, 7,'inquiry',7,'Internal: send proposal within 3 business days of call','Victoria drafts and sends proposal','relative_date',NULL,3,'previous_step',true,'owner','create_task','always',false,NULL),
  (v_template_id, 8,'inquiry',8,'Proposal sent (notification)','Notify couple proposal is ready','event','proposal_sent',NULL,NULL,false,'system','draft_email','always',true,NULL),
  (v_template_id, 9,'inquiry',9,'Reminder: proposal awaiting decision','Gentle nudge after 5 business days','relative_date',NULL,5,'previous_step',true,'system','draft_email','always',true,NULL),
  (v_template_id,10,'inquiry',10,'Reminder: proposal expiring','Final nudge before proposal expiry','relative_date',NULL,-3,'proposal_valid_until',false,'system','draft_email','always',true,NULL),
  (v_template_id,11,'inquiry',11,'Proposal accepted','Couple accepted proposal','event','proposal_accepted',NULL,NULL,false,'system','status_change','always',false,NULL),
  (v_template_id,12,'inquiry',12,'Contract sent (notification)','Contract delivered for signing','event','contract_sent',NULL,NULL,false,'system','draft_email','always',true,NULL),
  (v_template_id,13,'inquiry',13,'Retainer invoice sent (notification)','Retainer invoice delivered','event','retainer_invoice_sent',NULL,NULL,false,'system','draft_email','always',true,NULL),
  (v_template_id,14,'inquiry',14,'Reminder: contract or retainer pending','Reminder if either still outstanding','relative_date',NULL,3,'previous_step',true,'system','draft_email','always',true,NULL),
  (v_template_id,15,'inquiry',15,'BOOKED','Status flips to booked, materialize Stages 1-7','event','booked',NULL,NULL,false,'system','status_change','always',true,NULL),

  -- STAGE 1 — WELCOME
  (v_template_id,16,'welcome',1,'Welcome email','Warm welcome from Victoria','relative_date',NULL,0,'booking_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,17,'welcome',2,'Full portal unlocked','All portal areas now accessible','relative_date',NULL,0,'booking_date',false,'system','show_portal_item','always',true,NULL),
  (v_template_id,18,'welcome',3,'Client Welcome Guide surfaces','Welcome guide appears in resources','relative_date',NULL,0,'booking_date',false,'system','show_portal_item','always',true,NULL),
  (v_template_id,19,'welcome',4,'Internal: review onboarding','Dexter audits client setup','relative_date',NULL,1,'booking_date',true,'manager','create_task','always',false,NULL),
  (v_template_id,20,'welcome',5,'Engagement branch activates','Stage 2 unlocked for engagement clients','relative_date',NULL,0,'booking_date',false,'system','status_change','has_engagement',true,NULL),

  -- STAGE 2 — ENGAGEMENT
  (v_template_id,21,'engagement',1,'Pick your engagement date prompt','Couple invited to choose date','relative_date',NULL,28,'booking_date',false,'system','draft_email','has_engagement',true,NULL),
  (v_template_id,22,'engagement',2,'Engagement questionnaire sent','Pre-shoot questionnaire delivered','relative_date',NULL,28,'booking_date',false,'system','send_questionnaire','has_engagement',true,NULL),
  (v_template_id,23,'engagement',3,'Reminder: engagement date not picked (recurring every 30 days until engagement_session_scheduled)','Recurring nudge every 30 days','relative_date',NULL,30,'previous_step',false,'system','reminder','has_engagement',true,NULL),
  (v_template_id,24,'engagement',4,'Engagement date confirmed','Date locked in calendar','event','engagement_session_scheduled',NULL,NULL,false,'owner','create_task','has_engagement',true,NULL),
  (v_template_id,25,'engagement',5,'Pre-session prep email','Logistics + tips two weeks out','relative_date',NULL,-14,'engagement_session_date',false,'system','draft_email','has_engagement',true,NULL),
  (v_template_id,26,'engagement',6,'Engagement session day','Day-of marker','relative_date',NULL,0,'engagement_session_date',false,'owner','status_change','has_engagement',true,NULL),
  (v_template_id,27,'engagement',7,'Internal: upload engagement RAW within 48 hours','Victoria uploads RAW files','relative_date',NULL,2,'engagement_session_date',false,'owner','create_task','has_engagement',false,NULL),
  (v_template_id,28,'engagement',8,'Internal: send engagement to editor','Hand off to editor','event','engagement_raw_uploaded',NULL,NULL,false,'manager','create_task','has_engagement',false,NULL),
  (v_template_id,29,'engagement',9,'Internal: editor mid-check (engagement)','Check-in on editor progress','relative_date',NULL,7,'previous_step',true,'manager','create_task','has_engagement',false,NULL),
  (v_template_id,30,'engagement',10,'Internal: review engagement edits','Victoria reviews + approves','event','engagement_editor_returned_gallery',NULL,NULL,false,'owner','create_task','has_engagement',false,NULL),
  (v_template_id,31,'engagement',11,'Engagement gallery delivered','Gallery delivered to couple','event','engagement_gallery_delivered',NULL,NULL,false,'system','draft_email','has_engagement',true,NULL),
  (v_template_id,32,'engagement',12,'Internal: process editor payment (engagement)','Pay editor for engagement work','relative_date',NULL,0,'previous_step',false,'manager','create_task','has_engagement',false,NULL),

  -- STAGE 3 — PRE-WEDDING
  (v_template_id,33,'pre_wedding',1,'Logistics form sent','Wedding logistics questionnaire','relative_date',NULL,-56,'wedding_date',false,'system','send_questionnaire','always',true,NULL),
  (v_template_id,34,'pre_wedding',2,'Reminder: logistics form not started','Nudge if questionnaire untouched','relative_date',NULL,-42,'wedding_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,35,'pre_wedding',3,'Reminder: logistics form incomplete','Nudge if in progress','relative_date',NULL,-35,'wedding_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,36,'pre_wedding',4,'Logistics form due back','Hard deadline; escalate if missed','relative_date',NULL,-28,'wedding_date',false,'client','reminder','always',true,NULL),
  (v_template_id,37,'pre_wedding',5,'Internal: build wedding timeline','Victoria drafts timeline','relative_date',NULL,-28,'wedding_date',false,'owner','create_task','always',false,NULL),
  (v_template_id,38,'pre_wedding',6,'Timeline draft shared with couple','Timeline ready for review','event','timeline_complete',NULL,NULL,false,'system','draft_email','always',true,NULL),
  (v_template_id,39,'pre_wedding',7,'Final review call booking prompt','Invite couple to book review call','relative_date',NULL,-21,'wedding_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,40,'pre_wedding',8,'Final review call held','Call to align on day-of plan','event','review_call_complete',NULL,NULL,false,'owner','status_change','always',true,NULL),
  (v_template_id,41,'pre_wedding',9,'Internal: timeline finalized','Lock the timeline post-call','event','review_call_complete',NULL,NULL,false,'owner','create_task','always',false,NULL),
  (v_template_id,42,'pre_wedding',10,'Wedding week prep email','Final notes for the week of','relative_date',NULL,-7,'wedding_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,43,'pre_wedding',11,'Internal: compile final shot list','Dexter prepares shot list','relative_date',NULL,-3,'wedding_date',false,'manager','create_task','always',false,NULL),
  (v_template_id,44,'pre_wedding',12,'Internal: pre-wedding briefing','Team alignment 2 days out','relative_date',NULL,-2,'wedding_date',false,'manager','create_task','always',false,NULL),

  -- STAGE 4 — WEDDING DAY
  (v_template_id,45,'wedding_day',1,'Wedding day','The day','relative_date',NULL,0,'wedding_date',false,'owner','status_change','always',true,NULL),
  (v_template_id,46,'wedding_day',2,'Internal: Dexter on remote standby','Dexter monitors throughout day','relative_date',NULL,0,'wedding_date',false,'manager','create_task','always',false,NULL),
  (v_template_id,47,'wedding_day',3,'Internal: upload wedding RAW within 48 hours','Victoria uploads RAW files','relative_date',NULL,2,'wedding_date',false,'owner','create_task','always',false,NULL),

  -- STAGE 5 — POST-WEDDING
  (v_template_id,48,'post_wedding',1,'Internal: organize RAW into folders','Folder structure for editor','event','wedding_raw_uploaded',NULL,NULL,false,'owner','create_task','always',false,NULL),
  (v_template_id,49,'post_wedding',2,'Internal: backup RAW to second location','Secondary storage for safety','event','wedding_raw_uploaded',NULL,NULL,false,'owner','create_task','always',false,NULL),
  (v_template_id,50,'post_wedding',3,'Internal: select sneak peeks','Pick 5-10 sneak peek images','relative_date',NULL,2,'wedding_date',false,'owner','create_task','always',false,NULL),
  (v_template_id,51,'post_wedding',4,'Sneak peeks delivered (via portal)','Sneak peeks live on portal','event','sneak_peeks_uploaded',NULL,NULL,false,'system','show_portal_item','always',true,NULL),
  (v_template_id,52,'post_wedding',5,'Internal: grant editor access to wedding folder','Editor pulls; deadline = wedding+14 days (calendar)','relative_date',NULL,5,'wedding_date',false,'manager','create_task','always',false,NULL),
  (v_template_id,53,'post_wedding',6,'Internal: editor mid-check (full gallery)','Check editor progress','relative_date',NULL,7,'previous_step',true,'manager','create_task','always',false,NULL),
  (v_template_id,54,'post_wedding',7,'Internal: review editor''s gallery + export','Victoria reviews + exports','event','editor_files_returned',NULL,NULL,false,'owner','create_task','always',false,NULL),
  (v_template_id,55,'post_wedding',8,'Internal: editor revisions if needed','Optional revision loop','event','revision_requested',NULL,NULL,false,'manager','create_task','always',false,NULL),
  (v_template_id,56,'post_wedding',9,'Internal: upload to Pic-Time','Final gallery to Pic-Time','event','edits_approved',NULL,NULL,false,'owner','create_task','always',false,NULL),
  (v_template_id,57,'post_wedding',10,'Full gallery delivered','Gallery live for couple; status → delivered','event','pic_time_uploaded',NULL,NULL,false,'system','draft_email','always',true,NULL),
  (v_template_id,58,'post_wedding',11,'Internal: process editor payment','Pay editor for wedding','event','gallery_delivered',NULL,NULL,false,'manager','create_task','always',false,NULL),
  (v_template_id,59,'post_wedding',12,'Album upsell email','Only if no album purchased','relative_date',NULL,7,'gallery_delivery_date',true,'system','draft_email','NOT_has_album_purchased',true,NULL),
  (v_template_id,60,'post_wedding',13,'Thank you + testimonial request','Gratitude + testimonial ask','relative_date',NULL,7,'gallery_delivery_date',true,'system','draft_email','always',true,NULL),
  (v_template_id,61,'post_wedding',14,'Reminder: testimonial pending','Nudge if no testimonial','relative_date',NULL,21,'gallery_delivery_date',false,'system','draft_email','always',true,NULL),

  -- STAGE 6 — ALBUM
  (v_template_id,62,'album',1,'Album questionnaire sent','Style + image preferences','event','album_workflow_activated',NULL,NULL,false,'system','send_questionnaire','has_album_active',true,NULL),
  (v_template_id,63,'album',2,'Reminder: album image selection','Nudge if selection not started','relative_date',NULL,14,'previous_step',false,'system','draft_email','has_album_active',true,NULL),
  (v_template_id,64,'album',3,'Couple selects images','Couple submits selections','event','image_selection_complete',NULL,NULL,false,'client','status_change','has_album_active',true,NULL),
  (v_template_id,65,'album',4,'Album design draft','Designer creates draft','relative_date',NULL,7,'previous_step',true,'manager','create_task','has_album_active',false,NULL),
  (v_template_id,66,'album',5,'Album proof sent','Proof shared with couple','event','album_proof_sent',NULL,NULL,false,'system','draft_email','has_album_active',true,NULL),
  (v_template_id,67,'album',6,'Couple feedback','Couple reviews proof','relative_date',NULL,7,'previous_step',false,'client','reminder','has_album_active',true,NULL),
  (v_template_id,68,'album',7,'Internal revisions','Apply couple feedback','event','revision_requested',NULL,NULL,false,'manager','create_task','has_album_active',false,NULL),
  (v_template_id,69,'album',8,'Couple final approval','Approval to print','event','album_approved',NULL,NULL,false,'client','status_change','has_album_active',true,NULL),
  (v_template_id,70,'album',9,'Internal: send to print','Submit to printer','relative_date',NULL,1,'previous_step',true,'manager','create_task','has_album_active',false,NULL),
  (v_template_id,71,'album',10,'Album shipped','Tracking added; couple notified','event','album_shipped',NULL,NULL,false,'system','draft_email','has_album_active',true,NULL),
  (v_template_id,72,'album',11,'Album delivered','Confirmed delivery','event','album_delivered',NULL,NULL,false,'system','draft_email','has_album_active',true,NULL),

  -- STAGE 7 — LONG TAIL
  (v_template_id,73,'long_tail',1,'One-year anniversary email','Warm anniversary note','relative_date',NULL,365,'wedding_date',false,'system','draft_email','always',true,NULL),
  (v_template_id,74,'long_tail',2,'Status flips to archived','Archive client','relative_date',NULL,540,'wedding_date',false,'system','status_change','always',false,NULL);
END $seed$;
