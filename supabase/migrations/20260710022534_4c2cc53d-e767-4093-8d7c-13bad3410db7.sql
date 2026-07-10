
CREATE UNIQUE INDEX IF NOT EXISTS questionnaires_client_template_unique
  ON public.questionnaires (client_id, template_id)
  WHERE client_id IS NOT NULL AND template_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.client_has_engagement(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.packages p ON p.id = c.package_id
    WHERE c.id = _client_id AND p.includes_engagement = true
  ) OR EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.quote_items qi ON qi.quote_id = q.id
    LEFT JOIN public.service_items si ON si.id = qi.service_item_id
    WHERE q.client_id = _client_id
      AND q.status = 'accepted'
      AND (
        qi.item_type_snapshot = 'engagement_session'
        OR si.item_type = 'engagement_session'
        OR qi.description_snapshot ILIKE '%engagement%'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.client_has_engagement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_has_engagement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_default_forms(_client_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names text[] := ARRAY['Wedding Details & Logistics', 'Your Love Story'];
  v_inserted int := 0;
  v_tmpl_id uuid;
BEGIN
  IF _client_id IS NULL THEN RETURN 0; END IF;

  FOR v_tmpl_id IN
    SELECT id FROM public.questionnaire_templates
    WHERE is_active = true AND name = ANY(v_names)
  LOOP
    INSERT INTO public.questionnaires (client_id, template_id, status)
    SELECT _client_id, v_tmpl_id, 'not_started'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.questionnaires
      WHERE client_id = _client_id AND template_id = v_tmpl_id
    );
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  IF public.client_has_engagement(_client_id) THEN
    SELECT id INTO v_tmpl_id FROM public.questionnaire_templates
     WHERE is_active = true AND name = 'Engagement Session Questions'
     LIMIT 1;
    IF v_tmpl_id IS NOT NULL THEN
      INSERT INTO public.questionnaires (client_id, template_id, status)
      SELECT _client_id, v_tmpl_id, 'not_started'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.questionnaires
        WHERE client_id = _client_id AND template_id = v_tmpl_id
      );
      IF FOUND THEN v_inserted := v_inserted + 1; END IF;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_default_forms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_default_forms(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_assign_default_forms_on_booked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'booked' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'booked') THEN
    PERFORM public.assign_default_forms(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_assign_default_forms ON public.clients;
CREATE TRIGGER clients_assign_default_forms
  AFTER INSERT OR UPDATE OF status ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.trg_assign_default_forms_on_booked();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.clients WHERE status = 'booked' LOOP
    PERFORM public.assign_default_forms(r.id);
  END LOOP;
END $$;
