-- 1. portrait_sequences table
CREATE TABLE public.portrait_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  questionnaire_response_id uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_from text NOT NULL DEFAULT 'auto',
  partner_1_sequence jsonb DEFAULT '[]'::jsonb,
  partner_2_sequence jsonb DEFAULT '[]'::jsonb,
  combined_sequence jsonb DEFAULT '[]'::jsonb,
  wedding_party_shots jsonb DEFAULT '[]'::jsonb,
  extended_shots jsonb DEFAULT '[]'::jsonb,
  total_minutes int,
  notes text,
  manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portrait_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages portrait_sequences"
ON public.portrait_sequences FOR ALL
USING (is_owner(auth.uid())) WITH CHECK (is_owner(auth.uid()));

CREATE POLICY "Manager manages portrait_sequences for assigned"
ON public.portrait_sequences FOR ALL
USING (is_studio_manager(auth.uid()) AND is_assigned_to_client(client_id))
WITH CHECK (is_studio_manager(auth.uid()) AND is_assigned_to_client(client_id));

CREATE POLICY "Associate reads portrait_sequences for own clients"
ON public.portrait_sequences FOR SELECT
USING (is_associate(auth.uid()) AND is_assigned_to_client(client_id));

CREATE POLICY "Client reads own portrait_sequences"
ON public.portrait_sequences FOR SELECT
USING (is_client_of(auth.uid(), client_id));

CREATE TRIGGER trg_portrait_sequences_updated_at
BEFORE UPDATE ON public.portrait_sequences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Archive old template, seed new
UPDATE public.questionnaire_templates
SET is_active = false, is_archived = true, updated_at = now()
WHERE name = 'Wedding Day Logistics';

INSERT INTO public.questionnaire_templates (name, description, stage, is_active, schema)
VALUES (
  'Wedding Details & Logistics',
  'Tell us everything we need to know to photograph your wedding day with confidence.',
  'pre_wedding',
  true,
  '[
    {"id":"section_basics","type":"section_header","label":"Section 1 — The basics","helper":"A few things to confirm."},
    {"id":"wedding_day_contact","type":"short_text","label":"Best contact number for the wedding day","required":true,"helper":"Who should we call if anything comes up?"},
    {"id":"section_getting_ready","type":"section_header","label":"Section 2 — Getting ready","helper":"Where the day begins."},
    {"id":"getting_ready_address","type":"long_text","label":"Where are you two getting ready?","required":true,"helper":"Include addresses. If both partners are getting ready in different places, list both."},
    {"id":"hmu_location","type":"single_select","label":"Hair and makeup","required":true,"options":["Coming to us","Going to a salon","Mix of both"]},
    {"id":"hmu_start_times","type":"long_text","label":"Hair and makeup start times","required":true,"helper":"If both of you are getting HMU, list both times separately. TBD or flexible is okay, we will work with you."},
    {"id":"hair_vendor","type":"vendor_entry","label":"Hair vendor"},
    {"id":"makeup_vendor","type":"vendor_entry","label":"Makeup vendor"},
    {"id":"section_ceremony","type":"section_header","label":"Section 3 — Ceremony","helper":"The main event."},
    {"id":"ceremony_address","type":"short_text","label":"Ceremony venue + address","required":true},
    {"id":"ceremony_start_time","type":"time","label":"Ceremony start time","required":true},
    {"id":"ceremony_length","type":"single_select","label":"Estimated ceremony length","required":true,"options":["15-20 min (short and sweet)","30 min","45 min","60 min","90 min","Other (please specify in notes)"]},
    {"id":"has_first_look","type":"single_select","label":"Are you doing a first look?","required":true,"options":["Yes","No"]},
    {"id":"first_look_time","type":"short_text","label":"Estimated first look time","helper":"Does not have to be exact. Around 12:30 or 1pm is great.","conditional":{"on":"has_first_look","equals":"Yes"}},
    {"id":"first_look_location","type":"long_text","label":"First look location preference","helper":"If you have a few in mind based on weather, list them in order of preference.","conditional":{"on":"has_first_look","equals":"Yes"}},
    {"id":"ketubah_or_ritual","type":"long_text","label":"Will there be a Ketubah signing or other religious ritual before the ceremony?","helper":"If yes, briefly describe. We will add 15 min in our timeline."},
    {"id":"ceremony_exit","type":"single_select","label":"Ceremony exit","options":["Rose petals","Bubbles","Confetti","Sparklers","Nothing planned","Other (specify in notes)"]},
    {"id":"section_reception","type":"section_header","label":"Section 4 — Travel & reception","helper":"Where the celebration continues."},
    {"id":"same_address_reception","type":"single_select","label":"Same address for reception?","required":true,"options":["Yes — ceremony and reception at the same place","No — different venue"]},
    {"id":"reception_address","type":"short_text","label":"Reception venue + address","helper":"Only if different from ceremony.","conditional":{"on":"same_address_reception","equals":"No — different venue"}},
    {"id":"transportation_notes","type":"long_text","label":"Transportation between ceremony and reception","helper":"Tell us about any planned transportation.","conditional":{"on":"same_address_reception","equals":"No — different venue"}},
    {"id":"has_cocktail_hour","type":"single_select","label":"Will you be having a cocktail hour?","required":true,"options":["Yes","No"]},
    {"id":"reception_start_time","type":"time","label":"Reception start time","required":true},
    {"id":"reception_end_time","type":"time","label":"Reception end time","required":true},
    {"id":"reception_schedule","type":"timeline_events","label":"Reception schedule","required":true,"helper":"Add each event happening during your reception with its time. Examples: Grand entrance, First course, Toasts, Main course, First dance, Cake cutting, Open dancing, Bouquet toss, Send-off."},
    {"id":"dinner_end_time","type":"time","label":"Approximate dinner end time","required":true,"helper":"When does dinner service end? We use this to calculate when coverage ends."},
    {"id":"special_reception_moments","type":"long_text","label":"Special reception moments","helper":"Special dances, traditions, surprise performances, anything we should be prepared for?"},
    {"id":"section_family","type":"section_header","label":"Section 5 — Your family","helper":"We will use this to build your portrait sequence. No Excel spreadsheet, promise."},
    {"id":"partner_1_family","type":"family_portrait_sequence","label":"Partner 1 side","helper":"Tell us about Partner 1 family."},
    {"id":"partner_2_family","type":"family_portrait_sequence","label":"Partner 2 side","helper":"Tell us about Partner 2 family."},
    {"id":"combined_family_photo","type":"single_select","label":"Combined family photo?","required":true,"options":["Yes, all parents and siblings together","Yes, but only parents (no siblings)","No, family dynamics make this complicated"]},
    {"id":"family_circumstances","type":"long_text","label":"Special family circumstances","helper":"Recent illness, deaths, divorces with tension, family members who should not be photographed together, immigration restrictions, anything we should be sensitive about."},
    {"id":"section_wedding_party","type":"section_header","label":"Section 6 — Wedding party","helper":"Who is standing with you."},
    {"id":"wedding_party","type":"wedding_party_shots","label":"Wedding party","helper":"If no formal wedding party, set total to 0."},
    {"id":"section_photo_wishlist","type":"section_header","label":"Section 7 — Photo wishlist","helper":"What matters most visually."},
    {"id":"must_have_shots","type":"long_text","label":"Must-have shots","helper":"Specific poses, meaningful details, candid moments."},
    {"id":"pinterest_link","type":"short_text","label":"Pinterest board or inspo link","helper":"If you have one, drop the link here."},
    {"id":"couple_portrait_locations","type":"long_text","label":"Couple portrait location preferences","helper":"Any must-have spots for our portrait time? Leave blank if open."},
    {"id":"extended_portraits","type":"extended_portrait_shots","label":"Extended family / friend group shots","helper":"Cousins, sorority sisters, college friends, neighborhood crew, anyone you want a group photo of."},
    {"id":"publication_permission","type":"single_select","label":"Permission to publish","required":true,"options":["Yes — feel free to submit to wedding blogs","Yes, but ask me first","No — please keep our photos private"]},
    {"id":"section_vendors","type":"section_header","label":"Section 8 — Vendor team","helper":"Who else is making your day happen."},
    {"id":"planner_vendor","type":"vendor_entry","label":"Planner or coordinator","helper":"If your venue has a built-in coordinator, list them here."},
    {"id":"dj_band_vendor","type":"vendor_entry","label":"DJ or band","required":true},
    {"id":"videographer_vendor","type":"vendor_entry","label":"Videographer","helper":"Skip if you don''t have one."},
    {"id":"florist_vendor","type":"vendor_entry","label":"Florist","required":true},
    {"id":"caterer_vendor","type":"vendor_entry","label":"Caterer","required":true},
    {"id":"baker_vendor","type":"vendor_entry","label":"Baker / cake","helper":"Skip if same as caterer."},
    {"id":"rental_vendor","type":"vendor_entry","label":"Rental company","helper":"Skip if not applicable."},
    {"id":"dress_tux_designers","type":"long_text","label":"Dress and tux designers","helper":"Include the designer name + IG handle for each look (ceremony dress, party dress, tux, etc.)."}
  ]'::jsonb
);