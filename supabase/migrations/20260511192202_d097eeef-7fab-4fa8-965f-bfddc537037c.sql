
ALTER TABLE public.payment_schedule_template_installments
  ALTER COLUMN due_offset_days DROP NOT NULL;

WITH t AS (
  INSERT INTO public.payment_schedule_templates (name, package_id, is_active)
  VALUES ('Standard 3-payment', NULL, true)
  RETURNING id
)
INSERT INTO public.payment_schedule_template_installments (template_id, sequence_order, label, percentage, due_offset_type, due_offset_days)
SELECT t.id, v.seq, v.label, v.pct, v.dot::due_offset_type, v.dod
FROM t,
(VALUES
  (0, 'Retainer', 30.00, 'on_booking', NULL::int),
  (1, 'Mid-payment', 40.00, 'days_after_booking', 60),
  (2, 'Final', 30.00, 'days_before_event', 14)
) AS v(seq, label, pct, dot, dod);
