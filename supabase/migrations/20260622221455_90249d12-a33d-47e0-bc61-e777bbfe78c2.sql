
-- =========================================================================
-- Scheduling Slice 2: rename legacy bookings, then schema + RLS
-- =========================================================================

-- 0a. Rename legacy bookings table out of the way (it is empty)
ALTER TABLE IF EXISTS public.bookings RENAME TO legacy_bookings;

-- 0b. clients.pipeline_stage
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pipeline_stage text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_pipeline_stage_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_pipeline_stage_check
  CHECK (pipeline_stage IS NULL OR pipeline_stage IN
    ('new_inquiry','discovery_call','proposal_sent','contract_sent','booked'));

UPDATE public.clients
SET pipeline_stage = CASE
  WHEN status = 'lead' THEN 'new_inquiry'
  WHEN status IN ('booked','active','delivered','complete','archived') THEN 'booked'
  ELSE 'new_inquiry'
END
WHERE pipeline_stage IS NULL;

-- 1. enums
DO $$ BEGIN
  CREATE TYPE public.call_location_type AS ENUM ('zoom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.call_type_field_type AS ENUM
    ('text','textarea','email','date','dropdown','checkbox');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_status AS ENUM
    ('confirmed','cancelled','rescheduled','completed','no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_source AS ENUM ('public','manual_invite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_cancelled_by AS ENUM ('couple','owner','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_reminder_kind AS ENUM
    ('confirmation','reminder_24h','reminder_1h','owner_notification','cancelled','rescheduled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_reminder_status AS ENUM
    ('pending','sent','failed','skipped','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. scheduling_settings
CREATE TABLE IF NOT EXISTS public.scheduling_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'America/New_York',
  buffer_minutes int NOT NULL DEFAULT 15,
  min_lead_time_hours int NOT NULL DEFAULT 8,
  lookahead_days int NOT NULL DEFAULT 60,
  primary_calendar_id text,
  also_busy_from_calendar_ids text[] NOT NULL DEFAULT '{}',
  owner_notification_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_settings TO authenticated;
GRANT ALL ON public.scheduling_settings TO service_role;
ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage scheduling_settings" ON public.scheduling_settings;
CREATE POLICY "Owners manage scheduling_settings" ON public.scheduling_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
DROP TRIGGER IF EXISTS scheduling_settings_touch_updated_at ON public.scheduling_settings;
CREATE TRIGGER scheduling_settings_touch_updated_at
  BEFORE UPDATE ON public.scheduling_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. call_types
CREATE TABLE IF NOT EXISTS public.call_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  duration_minutes int NOT NULL,
  color text NOT NULL DEFAULT '#7C5E99',
  location_type public.call_location_type NOT NULL DEFAULT 'zoom',
  pipeline_stage_on_book text NOT NULL DEFAULT 'discovery_call'
    CHECK (pipeline_stage_on_book IN
      ('new_inquiry','discovery_call','proposal_sent','contract_sent','booked')),
  is_active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS call_types_slug_unique ON public.call_types (lower(slug));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_types TO authenticated;
GRANT SELECT ON public.call_types TO anon;
GRANT ALL ON public.call_types TO service_role;
ALTER TABLE public.call_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads active call_types" ON public.call_types;
CREATE POLICY "Public reads active call_types" ON public.call_types
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "Owners manage call_types" ON public.call_types;
CREATE POLICY "Owners manage call_types" ON public.call_types
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
DROP TRIGGER IF EXISTS call_types_touch_updated_at ON public.call_types;
CREATE TRIGGER call_types_touch_updated_at
  BEFORE UPDATE ON public.call_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. call_type_fields
CREATE TABLE IF NOT EXISTS public.call_type_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type_id uuid NOT NULL REFERENCES public.call_types(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_type public.call_type_field_type NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  placeholder text,
  options jsonb,
  display_order int NOT NULL DEFAULT 0,
  field_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_type_id, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_type_fields TO authenticated;
GRANT SELECT ON public.call_type_fields TO anon;
GRANT ALL ON public.call_type_fields TO service_role;
ALTER TABLE public.call_type_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads fields of active call_types" ON public.call_type_fields;
CREATE POLICY "Public reads fields of active call_types" ON public.call_type_fields
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.call_types ct
    WHERE ct.id = call_type_fields.call_type_id AND ct.is_active = true
  ));
DROP POLICY IF EXISTS "Owners manage call_type_fields" ON public.call_type_fields;
CREATE POLICY "Owners manage call_type_fields" ON public.call_type_fields
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
DROP TRIGGER IF EXISTS call_type_fields_touch_updated_at ON public.call_type_fields;
CREATE TRIGGER call_type_fields_touch_updated_at
  BEFORE UPDATE ON public.call_type_fields
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. manual_invites (FK to bookings added after bookings created)
CREATE TABLE IF NOT EXISTS public.manual_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_type_id uuid REFERENCES public.call_types(id) ON DELETE SET NULL,
  prefill jsonb NOT NULL DEFAULT '{}'::jsonb,
  personal_note text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  used_at timestamptz,
  used_by_booking_id uuid,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_invites TO authenticated;
GRANT ALL ON public.manual_invites TO service_role;
ALTER TABLE public.manual_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage manual_invites" ON public.manual_invites;
CREATE POLICY "Owners manage manual_invites" ON public.manual_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
DROP TRIGGER IF EXISTS manual_invites_touch_updated_at ON public.manual_invites;
CREATE TRIGGER manual_invites_touch_updated_at
  BEFORE UPDATE ON public.manual_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. bookings (new scheduling schema)
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type_id uuid NOT NULL REFERENCES public.call_types(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone_snapshot text NOT NULL,
  visitor_timezone text,
  primary_email text NOT NULL,
  couple_name_1 text NOT NULL,
  couple_name_2 text,
  phone text,
  custom_field_responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  zoom_meeting_id text,
  zoom_join_url text,
  zoom_password text,
  google_calendar_event_id text,
  google_calendar_id text,
  source public.booking_source NOT NULL DEFAULT 'public',
  invite_token uuid,
  cancel_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  reschedule_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  cancelled_at timestamptz,
  cancelled_by public.booking_cancelled_by,
  cancellation_reason text,
  rescheduled_from_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON public.bookings (starts_at);
CREATE INDEX IF NOT EXISTS bookings_status_starts_at_idx ON public.bookings (status, starts_at);
CREATE INDEX IF NOT EXISTS bookings_client_id_idx ON public.bookings (client_id);
CREATE INDEX IF NOT EXISTS bookings_call_type_starts_idx ON public.bookings (call_type_id, starts_at);
GRANT SELECT, UPDATE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read bookings" ON public.bookings;
CREATE POLICY "Owners read bookings" ON public.bookings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));
DROP POLICY IF EXISTS "Owners update bookings" ON public.bookings;
CREATE POLICY "Owners update bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;
CREATE TRIGGER bookings_touch_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  ALTER TABLE public.manual_invites
    ADD CONSTRAINT manual_invites_used_by_booking_fk
    FOREIGN KEY (used_by_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. booking_reminders
CREATE TABLE IF NOT EXISTS public.booking_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind public.booking_reminder_kind NOT NULL,
  send_at timestamptz NOT NULL,
  status public.booking_reminder_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  postmark_message_id text,
  email_send_id uuid REFERENCES public.email_sends(id) ON DELETE SET NULL,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind)
);
CREATE INDEX IF NOT EXISTS booking_reminders_status_send_at_idx
  ON public.booking_reminders (status, send_at);
GRANT SELECT ON public.booking_reminders TO authenticated;
GRANT ALL ON public.booking_reminders TO service_role;
ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read booking_reminders" ON public.booking_reminders;
CREATE POLICY "Owners read booking_reminders" ON public.booking_reminders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));
