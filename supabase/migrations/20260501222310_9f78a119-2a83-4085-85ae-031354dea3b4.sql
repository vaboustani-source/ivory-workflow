DO $$
DECLARE
  v_client_id uuid := '9ad04193-fbea-4271-a1ac-571a270cb34d';
  v_template_id uuid;
BEGIN
  -- 1. Questionnaire template (shared, idempotent by name)
  SELECT id INTO v_template_id FROM public.questionnaire_templates
    WHERE name = 'Tell us about your wedding day' LIMIT 1;
  IF v_template_id IS NULL THEN
    INSERT INTO public.questionnaire_templates (name, description, stage, is_active, schema)
    VALUES (
      'Tell us about your wedding day',
      'A few details to help us prepare for your big day.',
      'planning',
      true,
      jsonb_build_array(
        jsonb_build_object(
          'id','venue_name','type','short_text','label','Where is your ceremony being held?',
          'helper','Venue name and city','required',true
        ),
        jsonb_build_object(
          'id','ceremony_time','type','time','label','What time does the ceremony begin?','required',true
        ),
        jsonb_build_object(
          'id','ceremony_date','type','date','label','Confirm the wedding date','required',true
        ),
        jsonb_build_object(
          'id','must_have_shots','type','long_text',
          'label','Are there any must-have shots or moments we should know about?',
          'helper','Family portraits, surprise moments, heirlooms — anything sentimental.','required',false
        ),
        jsonb_build_object(
          'id','dietary','type','multi_select',
          'label','Vendor-team dietary needs',
          'helper','Select any that apply for our crew on the day.',
          'options', jsonb_build_array('No restrictions','Vegetarian','Vegan','Gluten-free','Dairy-free','Nut allergy'),
          'required',false
        ),
        jsonb_build_object(
          'id','day_of_contact_name','type','short_text',
          'label','Day-of contact name',
          'helper','Someone other than the couple — planner, MOH, etc.','required',true
        ),
        jsonb_build_object(
          'id','day_of_contact_phone','type','phone',
          'label','Day-of contact phone','required',true
        )
      )
    )
    RETURNING id INTO v_template_id;
  END IF;

  -- 2. Unsigned contract (skip if any contract already exists for Sophia)
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE client_id = v_client_id) THEN
    INSERT INTO public.contracts (
      client_id, title, content, status, sent_at, signature_required_role
    ) VALUES (
      v_client_id,
      'Wedding Photography Contract — Sophia & Ethan',
      E'## Stories by Victoria — Wedding Photography Agreement\n\n' ||
      E'This agreement is between **Stories by Victoria** ("the Photographer") and **Sophia Reyes & Ethan Marlowe** ("the Couple") for wedding photography services on the date specified in your portal.\n\n' ||
      E'### 1. Coverage\n\nThe Photographer will provide up to eight (8) hours of continuous wedding-day coverage, including preparation, ceremony, portraits, and reception, as agreed in your selected package.\n\n' ||
      E'### 2. Deliverables\n\nA curated, color-corrected gallery of no fewer than 500 high-resolution images will be delivered within ten (10) weeks of the wedding date via private online gallery.\n\n' ||
      E'### 3. Retainer & Payment\n\nA non-refundable retainer of 30% of the total package price secures your date. The remaining balance is due fourteen (14) days before the wedding.\n\n' ||
      E'### 4. Cancellation\n\nIn the event of cancellation, the retainer is forfeit. Cancellations within sixty (60) days of the wedding date forfeit 50% of the remaining balance.\n\n' ||
      E'### 5. Image Rights\n\nThe Couple receives a personal-use license for all delivered images. The Photographer retains copyright and the right to use images for portfolio, marketing, and editorial purposes.\n\n' ||
      E'### 6. Acts of God\n\nIn the rare event of illness or unavoidable circumstances, the Photographer will arrange a qualified replacement of comparable skill, or refund all monies paid in full.\n\n' ||
      E'By signing below, the Couple confirms they have read, understood, and agreed to these terms.',
      'sent',
      now() - interval '2 days',
      'partner_1'
    );
  END IF;

  -- 3. Questionnaire instance for Sophia
  IF NOT EXISTS (SELECT 1 FROM public.questionnaires WHERE client_id = v_client_id) THEN
    INSERT INTO public.questionnaires (client_id, template_id, status, sent_at, due_date, responses)
    VALUES (v_client_id, v_template_id, 'not_started', now() - interval '1 day',
            (CURRENT_DATE + interval '14 days')::date, '{}'::jsonb);
  END IF;

  -- 4. Sample sent proposal
  IF NOT EXISTS (SELECT 1 FROM public.proposals WHERE client_id = v_client_id) THEN
    INSERT INTO public.proposals (
      client_id, status, version, line_items, subtotal, discount, total,
      personal_note, valid_until, sent_at
    ) VALUES (
      v_client_id, 'sent', 1,
      jsonb_build_array(
        jsonb_build_object('label','Wedding-day coverage (8 hours)','amount',6500),
        jsonb_build_object('label','Engagement session','amount',850),
        jsonb_build_object('label','Heirloom album (10x10, 30 spreads)','amount',1200)
      ),
      8550, 0, 8550,
      E'Sophia & Ethan — it was such a joy meeting you. Here is the package we discussed, with the engagement session and heirloom album included. I cannot wait to capture your day.\n\nwith care,\nVictoria',
      (CURRENT_DATE + interval '21 days')::date,
      now() - interval '3 days'
    );
  END IF;
END $$;