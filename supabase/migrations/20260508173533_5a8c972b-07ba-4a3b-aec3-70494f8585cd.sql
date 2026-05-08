
CREATE TABLE IF NOT EXISTS public.briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  ai_summary text,
  data jsonb NOT NULL,
  email_sent_to text,
  email_sent_at timestamptz,
  generated_by text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_generated_at ON public.briefings(generated_at DESC);

COMMENT ON COLUMN public.briefings.data IS 'Full structured snapshot of the briefing data — bookings, pipeline, financials, action items, red flags';
COMMENT ON COLUMN public.briefings.ai_summary IS 'Claude-generated 1-2 sentence summary at top of email';
COMMENT ON COLUMN public.briefings.generated_by IS 'cron | on_demand';

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio can view briefings"
  ON public.briefings FOR SELECT
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio can insert briefings"
  ON public.briefings FOR INSERT
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Studio can update briefings"
  ON public.briefings FOR UPDATE
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Owners can delete briefings"
  ON public.briefings FOR DELETE
  USING (public.is_owner(auth.uid()));
