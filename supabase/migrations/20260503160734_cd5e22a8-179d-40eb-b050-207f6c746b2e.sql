
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS coverage_hours numeric(4,1);

COMMENT ON COLUMN public.clients.coverage_hours IS 'Total booked photography coverage hours. Sum of base package + add-ons. Manually set when booking is finalized. Used by timeline generator to flag upsell opportunities.';

ALTER TABLE public.photography_timelines
  ADD COLUMN IF NOT EXISTS booked_coverage_hours numeric(4,1),
  ADD COLUMN IF NOT EXISTS generated_coverage_hours numeric(4,1),
  ADD COLUMN IF NOT EXISTS coverage_overage_hours numeric(4,1),
  ADD COLUMN IF NOT EXISTS coverage_status text;
