-- ENUMS
CREATE TYPE public.app_role AS ENUM ('owner', 'studio_manager', 'associate_photographer', 'client');
CREATE TYPE public.client_status AS ENUM ('lead', 'booked', 'active', 'delivered', 'complete', 'archived');
CREATE TYPE public.workflow_trigger_type AS ENUM ('relative_date', 'event', 'manual');
CREATE TYPE public.workflow_trigger_relative AS ENUM ('wedding_date', 'booking_date', 'engagement_session_date', 'gallery_delivery_date', 'previous_step');
CREATE TYPE public.workflow_responsible AS ENUM ('system', 'owner', 'manager', 'associate', 'client');
CREATE TYPE public.workflow_action_type AS ENUM ('create_task', 'draft_email', 'show_portal_item', 'send_questionnaire', 'send_invoice', 'status_change', 'reminder');
CREATE TYPE public.workflow_branch AS ENUM ('always', 'has_engagement', 'has_videography', 'has_album');
CREATE TYPE public.milestone_status AS ENUM ('upcoming', 'in_progress', 'complete', 'skipped');
CREATE TYPE public.communication_status AS ENUM ('drafted', 'awaiting_approval', 'approved', 'sent', 'skipped', 'edited');
CREATE TYPE public.contract_status AS ENUM ('draft', 'sent', 'signed');
CREATE TYPE public.proposal_status AS ENUM ('draft', 'sent', 'accepted', 'expired', 'revised');
CREATE TYPE public.questionnaire_status AS ENUM ('not_started', 'in_progress', 'complete');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue');
CREATE TYPE public.invoice_type AS ENUM ('retainer', 'final', 'album', 'other');
CREATE TYPE public.engagement_status AS ENUM ('pending_scheduling', 'scheduled', 'complete', 'delivered');
CREATE TYPE public.gallery_type AS ENUM ('engagement', 'wedding');
CREATE TYPE public.album_status AS ENUM ('pending_questionnaire', 'designing', 'proofing', 'approved', 'printing', 'shipped', 'delivered');
CREATE TYPE public.task_status AS ENUM ('pending', 'complete', 'skipped');
CREATE TYPE public.task_priority AS ENUM ('low', 'normal', 'high');
CREATE TYPE public.calendar_provider AS ENUM ('google');
CREATE TYPE public.availability_event_type AS ENUM ('discovery_call', 'timeline_review', 'engagement_session_consultation', 'custom');
CREATE TYPE public.booking_event_type AS ENUM ('discovery_call', 'timeline_review', 'engagement_consultation');
CREATE TYPE public.booking_status AS ENUM ('confirmed', 'cancelled', 'completed', 'no_show');
CREATE TYPE public.resource_category AS ENUM ('engagement_session', 'wedding_prep', 'albums_prints', 'faq', 'style_guides', 'travel_lodging', 'general');
CREATE TYPE public.resource_content_type AS ENUM ('article', 'pdf', 'video', 'link');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT, full_name TEXT,
  role public.app_role NOT NULL DEFAULT 'client',
  avatar_url TEXT, phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- PACKAGES
CREATE TABLE public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, description TEXT, base_price NUMERIC,
  includes_engagement BOOLEAN DEFAULT false,
  includes_videography BOOLEAN DEFAULT false,
  includes_album BOOLEAN DEFAULT false,
  default_hours INTEGER,
  includes_second_shooter BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true, display_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

-- CLIENTS
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_name_1 TEXT NOT NULL, couple_name_2 TEXT,
  primary_email TEXT NOT NULL, secondary_email TEXT, phone TEXT,
  wedding_date DATE, venue_name TEXT, venue_address TEXT, guest_count INTEGER,
  package_id UUID REFERENCES public.packages(id),
  package_price NUMERIC,
  has_engagement BOOLEAN DEFAULT false,
  has_videography BOOLEAN DEFAULT false,
  has_album BOOLEAN DEFAULT false,
  status public.client_status NOT NULL DEFAULT 'lead',
  photographer_id UUID REFERENCES public.profiles(id),
  manager_id UUID REFERENCES public.profiles(id),
  last_contacted_at TIMESTAMPTZ,
  portal_invited_at TIMESTAMPTZ,
  portal_first_login_at TIMESTAMPTZ,
  inquiry_source TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_clients_status ON public.clients(status);
CREATE INDEX idx_clients_wedding_date ON public.clients(wedding_date);
CREATE INDEX idx_clients_last_contacted_at ON public.clients(last_contacted_at);

-- CLIENT_USERS
CREATE TABLE public.client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  role_in_couple TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (created AFTER referenced tables)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_studio_user(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role IN ('owner','studio_manager','associate_photographer'))
$$;
CREATE OR REPLACE FUNCTION public.is_client_of(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.client_users WHERE user_id = _user_id AND client_id = _client_id)
$$;

-- CONVERSATIONS / MESSAGES
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id),
  content TEXT,
  is_internal_note BOOLEAN NOT NULL DEFAULT false,
  thread_parent_id UUID REFERENCES public.messages(id),
  attachment_url TEXT,
  read_by JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_conversation_created ON public.messages(conversation_id, created_at);

-- WORKFLOW
CREATE TABLE public.workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, version INTEGER DEFAULT 1, is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  step_number INTEGER, stage TEXT, title TEXT, description TEXT,
  trigger_type public.workflow_trigger_type,
  trigger_offset_days INTEGER,
  trigger_relative_to public.workflow_trigger_relative,
  trigger_event TEXT,
  responsible_party public.workflow_responsible,
  action_type public.workflow_action_type,
  email_template_id UUID, questionnaire_template_id UUID,
  branch_dependency public.workflow_branch DEFAULT 'always',
  is_client_visible BOOLEAN DEFAULT true,
  reminder_offset_days INTEGER, order_in_stage INTEGER
);
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.timeline_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  workflow_step_id UUID, title TEXT, description TEXT, due_date DATE,
  status public.milestone_status NOT NULL DEFAULT 'upcoming',
  completed_at TIMESTAMPTZ, completed_by UUID REFERENCES public.profiles(id),
  is_client_visible BOOLEAN NOT NULL DEFAULT true,
  is_overridden BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.timeline_milestones ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_milestones_client_due ON public.timeline_milestones(client_id, due_date);
CREATE INDEX idx_milestones_status_due ON public.timeline_milestones(status, due_date);

CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, stage TEXT, subject TEXT, body TEXT,
  merge_fields JSONB,
  requires_approval BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.scheduled_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  milestone_id UUID,
  email_template_id UUID REFERENCES public.email_templates(id),
  subject TEXT, body_draft TEXT,
  status public.communication_status NOT NULL DEFAULT 'drafted',
  scheduled_send_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  recipient_emails TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.scheduled_communications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sched_comm_status_send ON public.scheduled_communications(status, scheduled_send_at);

CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  title TEXT, file_url TEXT,
  status public.contract_status NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, signature_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  version INTEGER DEFAULT 1,
  status public.proposal_status NOT NULL DEFAULT 'draft',
  package_id UUID REFERENCES public.packages(id),
  line_items JSONB, subtotal NUMERIC, discount NUMERIC DEFAULT 0, total NUMERIC,
  personal_note TEXT, valid_until DATE,
  sent_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.questionnaire_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, stage TEXT, schema JSONB, description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.questionnaire_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.questionnaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  template_id UUID REFERENCES public.questionnaire_templates(id),
  status public.questionnaire_status NOT NULL DEFAULT 'not_started',
  responses JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ, due_date DATE, completed_at TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0
);
ALTER TABLE public.questionnaires ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  invoice_number TEXT, amount NUMERIC,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  invoice_type public.invoice_type,
  due_date DATE, stripe_payment_intent_id TEXT, paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.engagement_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID UNIQUE REFERENCES public.clients(id),
  scheduled_at TIMESTAMPTZ, location TEXT, location_notes TEXT,
  status public.engagement_status NOT NULL DEFAULT 'pending_scheduling',
  gallery_url TEXT, edited_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, notes TEXT
);
ALTER TABLE public.engagement_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  gallery_url TEXT,
  sneak_peek_due_date DATE, sneak_peek_delivered_at TIMESTAMPTZ,
  full_gallery_due_date DATE, delivered_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  gallery_type public.gallery_type
);
ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID UNIQUE REFERENCES public.clients(id),
  status public.album_status NOT NULL DEFAULT 'pending_questionnaire',
  questionnaire_responses JSONB, proof_url TEXT,
  revision_count INTEGER DEFAULT 0, tracking_number TEXT,
  ordered_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ
);
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  milestone_id UUID REFERENCES public.timeline_milestones(id),
  assignee_id UUID REFERENCES public.profiles(id),
  title TEXT, description TEXT, due_date DATE,
  status public.task_status NOT NULL DEFAULT 'pending',
  priority public.task_priority NOT NULL DEFAULT 'normal',
  auto_generated BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ, completed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tasks_assignee_status_due ON public.tasks(assignee_id, status, due_date);

CREATE TABLE public.calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.profiles(id),
  provider public.calendar_provider,
  access_token TEXT, refresh_token TEXT, calendar_id TEXT,
  is_active BOOLEAN DEFAULT true, last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.calendar_availability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  event_type public.availability_event_type,
  available_days JSONB, available_hours JSONB,
  duration_minutes INTEGER,
  buffer_before_minutes INTEGER DEFAULT 0,
  buffer_after_minutes INTEGER DEFAULT 0,
  min_notice_hours INTEGER DEFAULT 24,
  max_advance_days INTEGER DEFAULT 90,
  is_active BOOLEAN DEFAULT true
);
ALTER TABLE public.calendar_availability_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  booked_by_email TEXT,
  booked_by_user UUID REFERENCES public.profiles(id),
  event_type public.booking_event_type,
  scheduled_at TIMESTAMPTZ, duration_minutes INTEGER,
  google_event_id TEXT,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  meeting_link TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT, slug TEXT UNIQUE,
  category public.resource_category,
  content_type public.resource_content_type,
  content TEXT, file_url TEXT, external_url TEXT,
  featured_image_url TEXT, excerpt TEXT,
  surface_in_stages JSONB,
  is_published BOOLEAN DEFAULT false,
  display_order INTEGER,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  action_type TEXT, target_type TEXT, target_id UUID,
  description TEXT, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- updated_at triggers
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_workflow_templates_updated BEFORE UPDATE ON public.workflow_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_resources_updated BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS POLICIES
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Studio reads all profiles" ON public.profiles FOR SELECT USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Owners manage profiles" ON public.profiles FOR ALL USING (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Studio inserts profiles" ON public.profiles FOR INSERT WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio manages packages" ON public.packages FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Authenticated reads active packages" ON public.packages FOR SELECT USING (is_active = true);

CREATE POLICY "Studio manages clients" ON public.clients FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own record" ON public.clients FOR SELECT USING (public.is_client_of(auth.uid(), id));

CREATE POLICY "Studio manages client_users" ON public.client_users FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "User reads own client_users" ON public.client_users FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Studio manages conversations" ON public.conversations FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own conversation" ON public.conversations FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages messages" ON public.messages FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads non-internal messages" ON public.messages FOR SELECT USING (
  is_internal_note = false AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND public.is_client_of(auth.uid(), c.client_id)
  )
);
CREATE POLICY "Client inserts own messages" ON public.messages FOR INSERT WITH CHECK (
  is_internal_note = false AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND public.is_client_of(auth.uid(), c.client_id)
  )
);

CREATE POLICY "Studio manages workflow_templates" ON public.workflow_templates FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio manages workflow_steps" ON public.workflow_steps FOR ALL USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio manages milestones" ON public.timeline_milestones FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads visible milestones" ON public.timeline_milestones FOR SELECT USING (
  is_client_visible = true AND public.is_client_of(auth.uid(), client_id)
);

CREATE POLICY "Studio manages email_templates" ON public.email_templates FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Studio manages scheduled_communications" ON public.scheduled_communications FOR ALL USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio manages contracts" ON public.contracts FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own contracts" ON public.contracts FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages proposals" ON public.proposals FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own proposals" ON public.proposals FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages questionnaire_templates" ON public.questionnaire_templates FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Authenticated reads active questionnaire_templates" ON public.questionnaire_templates FOR SELECT USING (is_active = true);

CREATE POLICY "Studio manages questionnaires" ON public.questionnaires FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own questionnaires" ON public.questionnaires FOR SELECT USING (public.is_client_of(auth.uid(), client_id));
CREATE POLICY "Client updates own questionnaires" ON public.questionnaires FOR UPDATE USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages invoices" ON public.invoices FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own invoices" ON public.invoices FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages engagement_sessions" ON public.engagement_sessions FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own engagement_sessions" ON public.engagement_sessions FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages galleries" ON public.galleries FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own galleries" ON public.galleries FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages albums" ON public.albums FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own albums" ON public.albums FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages tasks" ON public.tasks FOR ALL USING (public.is_studio_user(auth.uid()));

CREATE POLICY "User manages own calendar_connections" ON public.calendar_connections FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Studio reads calendar_connections" ON public.calendar_connections FOR SELECT USING (public.is_studio_user(auth.uid()));

CREATE POLICY "User manages own availability_rules" ON public.calendar_availability_rules FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Studio reads availability_rules" ON public.calendar_availability_rules FOR SELECT USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio manages bookings" ON public.bookings FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Client reads own bookings" ON public.bookings FOR SELECT USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Studio manages resources" ON public.resources FOR ALL USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Authenticated reads published resources" ON public.resources FOR SELECT USING (is_published = true);

CREATE POLICY "Studio reads activity_log" ON public.activity_log FOR SELECT USING (public.is_studio_user(auth.uid()));
CREATE POLICY "Authenticated inserts activity_log" ON public.activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'client')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();