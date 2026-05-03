-- Contractor rolodex
CREATE TABLE public.contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  primary_role text,
  roles text[] NOT NULL DEFAULT '{}',
  preferred_min_hourly_rate integer,
  preferred_max_hourly_rate integer,
  instagram text,
  website text,
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads contractors" ON public.contractors
  FOR SELECT USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner manages contractors" ON public.contractors
  FOR ALL USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Manager manages contractors" ON public.contractors
  FOR ALL USING (public.is_studio_manager(auth.uid())) WITH CHECK (public.is_studio_manager(auth.uid()));

CREATE TRIGGER trg_contractors_updated_at
  BEFORE UPDATE ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Contractor service requests (availability outreach)
CREATE TYPE public.contractor_request_status AS ENUM (
  'pending', 'accepted', 'declined', 'withdrawn'
);

CREATE TABLE public.contractor_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  requested_role text NOT NULL,
  status public.contractor_request_status NOT NULL DEFAULT 'pending',
  message_to_contractor text,
  contractor_response_notes text,
  agreed_hourly_rate integer,
  agreed_hours numeric(5,2),
  agreed_total integer GENERATED ALWAYS AS (
    CASE
      WHEN agreed_hourly_rate IS NOT NULL AND agreed_hours IS NOT NULL
      THEN (agreed_hourly_rate * agreed_hours)::integer
      ELSE NULL
    END
  ) STORED,
  notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  accepted_at timestamptz,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_csr_client ON public.contractor_service_requests(client_id);
CREATE INDEX idx_csr_contractor ON public.contractor_service_requests(contractor_id);

ALTER TABLE public.contractor_service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads contractor_service_requests"
  ON public.contractor_service_requests FOR SELECT
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner manages contractor_service_requests"
  ON public.contractor_service_requests FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Manager manages contractor_service_requests for assigned"
  ON public.contractor_service_requests FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

CREATE TRIGGER trg_csr_updated_at
  BEFORE UPDATE ON public.contractor_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Wedding team (staffed contractors per wedding)
CREATE TABLE public.wedding_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  service_request_id uuid REFERENCES public.contractor_service_requests(id) ON DELETE SET NULL,
  role text NOT NULL,
  agreed_hourly_rate integer NOT NULL,
  agreed_hours numeric(5,2) NOT NULL,
  agreed_total integer GENERATED ALWAYS AS (
    (agreed_hourly_rate * agreed_hours)::integer
  ) STORED,
  coverage_window_start time,
  coverage_window_end time,
  notes text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wt_client ON public.wedding_team(client_id);
CREATE INDEX idx_wt_contractor ON public.wedding_team(contractor_id);

ALTER TABLE public.wedding_team ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads wedding_team"
  ON public.wedding_team FOR SELECT
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owner manages wedding_team"
  ON public.wedding_team FOR ALL
  USING (public.is_owner(auth.uid())) WITH CHECK (public.is_owner(auth.uid()));

CREATE POLICY "Manager manages wedding_team for assigned"
  ON public.wedding_team FOR ALL
  USING (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id))
  WITH CHECK (public.is_studio_manager(auth.uid()) AND public.is_assigned_to_client(client_id));

CREATE TRIGGER trg_wedding_team_updated_at
  BEFORE UPDATE ON public.wedding_team
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();