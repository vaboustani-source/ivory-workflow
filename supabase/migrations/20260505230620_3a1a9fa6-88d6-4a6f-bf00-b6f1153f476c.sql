
-- Drop the partial prior install (tables are empty)
DROP TABLE IF EXISTS public.wedding_team CASCADE;
DROP TABLE IF EXISTS public.contractor_service_requests CASCADE;
DROP TABLE IF EXISTS public.contractors CASCADE;
DROP TYPE IF EXISTS public.contractor_request_status CASCADE;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.contractor_role AS ENUM (
    'second_shooter','associate_photographer','videographer','second_videographer','photo_assistant'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_request_status AS ENUM (
    'sent','accepted','declined','no_response','cancelled','booked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- contractors
CREATE TABLE public.contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  roles contractor_role[] NOT NULL DEFAULT '{}',
  homebase_address text,
  homebase_lat double precision,
  homebase_lng double precision,
  rate_notes text,
  preferred_min_hourly_rate int,
  preferred_max_hourly_rate int,
  instagram text,
  portfolio_url text,
  bio text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  jobs_count int NOT NULL DEFAULT 0,
  last_worked_with_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_contractors_updated_at BEFORE UPDATE ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Studio reads contractors" ON public.contractors FOR SELECT TO authenticated
  USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio inserts contractors" ON public.contractors FOR INSERT TO authenticated
  WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio updates contractors" ON public.contractors FOR UPDATE TO authenticated
  USING (public.is_studio_user(auth.uid())) WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Owner deletes contractors" ON public.contractors FOR DELETE TO authenticated
  USING (public.is_owner(auth.uid()));

-- contracts: extend
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS counter_party_email text,
  ADD COLUMN IF NOT EXISTS counter_party_name text,
  ADD COLUMN IF NOT EXISTS contract_kind text NOT NULL DEFAULT 'couple',
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS public_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contracts_public_token_idx
  ON public.contracts(public_token) WHERE public_token IS NOT NULL;

-- contract_templates: type
ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'couple';

-- contractor_service_requests
CREATE TABLE public.contractor_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  role contractor_role NOT NULL,
  wedding_date date NOT NULL,
  ceremony_address text,
  travel_distance_miles numeric,
  travel_minutes int,
  status service_request_status NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES public.profiles(id),
  responded_at timestamptz,
  response_message text,
  response_logged_by uuid REFERENCES public.profiles(id),
  response_logged_at timestamptz,
  agreed_hourly_rate int,
  agreed_hours numeric(4,1),
  agreed_total int GENERATED ALWAYS AS (agreed_hourly_rate * agreed_hours) STORED,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csr_client_id_idx ON public.contractor_service_requests(client_id);
CREATE INDEX csr_contractor_id_idx ON public.contractor_service_requests(contractor_id);
CREATE INDEX csr_status_idx ON public.contractor_service_requests(status);
CREATE TRIGGER trg_csr_updated_at BEFORE UPDATE ON public.contractor_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.contractor_service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Studio reads csr" ON public.contractor_service_requests FOR SELECT TO authenticated
  USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio inserts csr" ON public.contractor_service_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio updates csr" ON public.contractor_service_requests FOR UPDATE TO authenticated
  USING (public.is_studio_user(auth.uid())) WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Owner deletes csr" ON public.contractor_service_requests FOR DELETE TO authenticated
  USING (public.is_owner(auth.uid()));

-- wedding_team
CREATE TABLE public.wedding_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  role contractor_role NOT NULL,
  agreed_hourly_rate int,
  agreed_hours numeric(4,1),
  agreed_total int GENERATED ALWAYS AS (agreed_hourly_rate * agreed_hours) STORED,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, contractor_id, role)
);
CREATE INDEX wedding_team_client_idx ON public.wedding_team(client_id);

ALTER TABLE public.wedding_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Studio reads wedding_team" ON public.wedding_team FOR SELECT TO authenticated
  USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Couple reads own wedding_team" ON public.wedding_team FOR SELECT TO authenticated
  USING (public.is_client_of(auth.uid(), client_id));
CREATE POLICY "Studio inserts wedding_team" ON public.wedding_team FOR INSERT TO authenticated
  WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio updates wedding_team" ON public.wedding_team FOR UPDATE TO authenticated
  USING (public.is_studio_user(auth.uid())) WITH CHECK (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio deletes wedding_team" ON public.wedding_team FOR DELETE TO authenticated
  USING (public.is_studio_user(auth.uid()));

-- clients.services_added
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS services_added jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Trigger: sourcing milestone on services_added change
CREATE OR REPLACE FUNCTION public.trg_create_sourcing_milestone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  service jsonb;
  role_label text;
  role_text text;
BEGIN
  IF NEW.services_added IS NULL THEN RETURN NEW; END IF;
  IF OLD.services_added IS NOT NULL AND OLD.services_added::text = NEW.services_added::text THEN
    RETURN NEW;
  END IF;

  FOR service IN SELECT * FROM jsonb_array_elements(NEW.services_added)
  LOOP
    IF OLD.services_added IS NOT NULL AND OLD.services_added @> jsonb_build_array(service) THEN
      CONTINUE;
    END IF;

    role_text := service->>'role';
    role_label := CASE role_text
      WHEN 'second_shooter' THEN 'Second Shooter'
      WHEN 'videographer' THEN 'Videographer'
      WHEN 'second_videographer' THEN 'Second Videographer'
      WHEN 'photo_assistant' THEN 'Photo Assistant'
      WHEN 'associate_photographer' THEN 'Associate Photographer'
      ELSE role_text
    END;

    INSERT INTO public.timeline_milestones (
      client_id, title, due_date, status, is_client_visible,
      action_type, responsible_party, stage, description, metadata
    ) VALUES (
      NEW.id,
      'Find a ' || role_label || ' for ' || NEW.couple_name_1 ||
        CASE WHEN NEW.couple_name_2 IS NOT NULL THEN ' & ' || NEW.couple_name_2 ELSE '' END,
      GREATEST(CURRENT_DATE + INTERVAL '14 days',
               COALESCE(NEW.wedding_date, CURRENT_DATE + INTERVAL '60 days') - INTERVAL '60 days')::date,
      'upcoming', false, 'task', 'owner', 'pre_wedding',
      'Couple has added ' || role_label || ' coverage. Open the Sourcing tool to find and book a contractor.',
      jsonb_build_object(
        'type','contractor_sourcing',
        'service_role', role_text,
        'service_added_at', service->>'added_at'
      )
    );
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clients_services_added ON public.clients;
CREATE TRIGGER trg_clients_services_added
  AFTER UPDATE OF services_added ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_sourcing_milestone();

-- Trigger: bump contractor stats on wedding_team insert
CREATE OR REPLACE FUNCTION public.trg_wedding_team_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.contractors
    SET jobs_count = jobs_count + 1,
        last_worked_with_at = now()
    WHERE id = NEW.contractor_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wedding_team_insert ON public.wedding_team;
CREATE TRIGGER trg_wedding_team_insert
  AFTER INSERT ON public.wedding_team
  FOR EACH ROW EXECUTE FUNCTION public.trg_wedding_team_after_insert();
