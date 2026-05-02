
-- =========================================================
-- photography_timelines
-- =========================================================
CREATE TABLE IF NOT EXISTS public.photography_timelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
  questionnaire_response_id uuid REFERENCES public.questionnaires(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_from text NOT NULL DEFAULT 'auto',

  ceremony_start_time time NOT NULL,
  ceremony_length_minutes int NOT NULL DEFAULT 30,
  has_first_look boolean NOT NULL DEFAULT false,
  has_jewish_ketubah boolean DEFAULT false,
  has_wedding_party boolean DEFAULT true,
  group_portrait_minutes int NOT NULL DEFAULT 60,

  getting_ready_address text,
  ceremony_address text,
  reception_address text,
  travel_minutes_gr_to_ceremony int DEFAULT 0,
  travel_minutes_ceremony_to_reception int DEFAULT 0,

  sunset_time time,
  golden_hour_start_time time,

  reception_events jsonb DEFAULT '[]'::jsonb,

  dinner_end_time time,
  coverage_end_time time NOT NULL,
  has_extended_dancing boolean DEFAULT false,

  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,

  manual_overrides jsonb DEFAULT '{}'::jsonb,
  notes_for_photographer text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photography_timelines_client_id
  ON public.photography_timelines(client_id);

DROP TRIGGER IF EXISTS trg_photography_timelines_updated_at ON public.photography_timelines;
CREATE TRIGGER trg_photography_timelines_updated_at
  BEFORE UPDATE ON public.photography_timelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.photography_timelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages photography_timelines" ON public.photography_timelines;
CREATE POLICY "Owner manages photography_timelines"
  ON public.photography_timelines FOR ALL
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manager manages photography_timelines for assigned"
  ON public.photography_timelines;
CREATE POLICY "Manager manages photography_timelines for assigned"
  ON public.photography_timelines FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

DROP POLICY IF EXISTS "Associate reads photography_timelines for own clients"
  ON public.photography_timelines;
CREATE POLICY "Associate reads photography_timelines for own clients"
  ON public.photography_timelines FOR SELECT
  USING (public.is_associate(auth.uid()) AND public.is_assigned_to_client(client_id));

DROP POLICY IF EXISTS "Client reads own photography_timeline"
  ON public.photography_timelines;
CREATE POLICY "Client reads own photography_timeline"
  ON public.photography_timelines FOR SELECT
  USING (public.is_client_of(auth.uid(), client_id));

-- =========================================================
-- Seed: Wedding Day Logistics questionnaire template
-- =========================================================
DO $$
DECLARE
  v_existing uuid;
  v_schema jsonb := '[
    {"id":"ceremony_start_time","type":"time","label":"What time does your ceremony start?","required":true},
    {"id":"ceremony_length","type":"single_select","label":"How long is your ceremony?","required":true,"options":["30 min","45 min","60 min","90 min","Other"]},
    {"id":"has_first_look","type":"single_select","label":"Are you doing a first look?","required":true,"options":["Yes","No"]},
    {"id":"ketubah_or_ritual","type":"short_text","label":"Will there be a Ketubah signing or other religious ritual before the ceremony?","helper":"If yes, briefly describe. We will add 15 minutes in our timeline."},
    {"id":"has_wedding_party","type":"single_select","label":"Will you have a wedding party?","required":true,"options":["Yes","No"]},
    {"id":"group_shots","type":"long_text","label":"Estimated number of group portrait shots","helper":"List the shots you want, e.g. Bride with parents, Groom with siblings, full bridal party, etc. Each shot takes about 1 minute, larger groups (7+ people) take about 2 minutes."},
    {"id":"getting_ready_address","type":"short_text","label":"Getting ready address","required":true},
    {"id":"same_address_ceremony","type":"single_select","label":"Same address for the ceremony?","required":true,"options":["Yes","No"]},
    {"id":"ceremony_address","type":"short_text","label":"Ceremony address","helper":"If different from getting ready","conditional":{"on":"same_address_ceremony","equals":"No"}},
    {"id":"same_address_reception","type":"single_select","label":"Same address for the reception?","required":true,"options":["Yes","No"]},
    {"id":"reception_address","type":"short_text","label":"Reception address","helper":"If different from ceremony","conditional":{"on":"same_address_reception","equals":"No"}},
    {"id":"reception_schedule","type":"timeline_events","label":"Reception schedule","helper":"Add each event happening during your reception with its time. We will incorporate this into your photography timeline. Examples: Grand entrance, First dance, First course, Toasts, Main course, Cake cutting, Parent dances, Open dancing, Bouquet/garter toss, Send-off."},
    {"id":"dinner_end_time","type":"time","label":"Dinner end time","required":true,"helper":"Approximately when does dinner service end? Used to calculate coverage end."},
    {"id":"extended_dancing","type":"single_select","label":"Are you adding extended dancing coverage?","options":["No, standard 60 min after dinner is fine","Yes, extra hour","Yes, more, please note in message"]}
  ]'::jsonb;
BEGIN
  SELECT id INTO v_existing
  FROM public.questionnaire_templates
  WHERE name = 'Wedding Day Logistics'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.questionnaire_templates (name, description, schema, stage, is_active, is_archived)
    VALUES (
      'Wedding Day Logistics',
      'Tell us how your wedding day will flow so we can build your photography timeline.',
      v_schema,
      'pre_wedding',
      true,
      false
    );
  ELSE
    UPDATE public.questionnaire_templates
    SET schema = v_schema,
        description = 'Tell us how your wedding day will flow so we can build your photography timeline.',
        stage = COALESCE(stage, 'pre_wedding'),
        is_active = true,
        is_archived = false,
        updated_at = now()
    WHERE id = v_existing;
  END IF;
END $$;
