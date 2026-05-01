
-- Contract templates
CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  content text NOT NULL DEFAULT '',
  signature_required_role text NOT NULL DEFAULT 'partner_1' 
    CHECK (signature_required_role IN ('partner_1', 'both_partners')),
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_templates_archived ON public.contract_templates(is_archived);

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages contract_templates"
  ON public.contract_templates FOR ALL
  USING (is_owner(auth.uid()))
  WITH CHECK (is_owner(auth.uid()));

CREATE POLICY "Studio reads contract_templates"
  ON public.contract_templates FOR SELECT
  USING (is_studio_user(auth.uid()));

CREATE POLICY "Manager inserts contract_templates"
  ON public.contract_templates FOR INSERT
  WITH CHECK (is_studio_manager(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Manager updates own contract_templates"
  ON public.contract_templates FOR UPDATE
  USING (is_studio_manager(auth.uid()) AND created_by = auth.uid())
  WITH CHECK (is_studio_manager(auth.uid()) AND created_by = auth.uid());

CREATE TRIGGER update_contract_templates_updated_at
  BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend questionnaire_templates
ALTER TABLE public.questionnaire_templates
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_questionnaire_templates_archived ON public.questionnaire_templates(is_archived);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_questionnaire_templates_updated_at') THEN
    CREATE TRIGGER update_questionnaire_templates_updated_at
      BEFORE UPDATE ON public.questionnaire_templates
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Add manager insert/update policies for questionnaire_templates (studio_user manage exists already)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'questionnaire_templates' AND policyname = 'Manager inserts questionnaire_templates') THEN
    CREATE POLICY "Manager inserts questionnaire_templates"
      ON public.questionnaire_templates FOR INSERT
      WITH CHECK (is_studio_manager(auth.uid()) AND created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'questionnaire_templates' AND policyname = 'Manager updates own questionnaire_templates') THEN
    CREATE POLICY "Manager updates own questionnaire_templates"
      ON public.questionnaire_templates FOR UPDATE
      USING (is_studio_manager(auth.uid()) AND created_by = auth.uid())
      WITH CHECK (is_studio_manager(auth.uid()) AND created_by = auth.uid());
  END IF;
END $$;

-- Extend contracts
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL;
