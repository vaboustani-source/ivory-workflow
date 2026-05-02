-- Reclassify timeline_milestones (text column).
UPDATE public.timeline_milestones
SET action_type = 'reminder'
WHERE title ILIKE 'Reminder:%' AND (action_type IS DISTINCT FROM 'reminder');

UPDATE public.timeline_milestones
SET action_type = 'system_event'
WHERE title IN (
  'Welcome email',
  'Full portal unlocked',
  'Grant inquiry portal access',
  'Client Welcome Guide surfaces',
  'Engagement branch activates',
  'Album branch activates',
  'Videography branch activates'
) AND (action_type IS DISTINCT FROM 'system_event');

-- Reclassify workflow_steps (enum column).
UPDATE public.workflow_steps
SET action_type = 'reminder'::workflow_action_type
WHERE title ILIKE 'Reminder:%' AND action_type::text <> 'reminder';

UPDATE public.workflow_steps
SET action_type = 'system_event'::workflow_action_type
WHERE title IN (
  'Welcome email',
  'Full portal unlocked',
  'Grant inquiry portal access',
  'Client Welcome Guide surfaces',
  'Engagement branch activates',
  'Album branch activates',
  'Videography branch activates'
) AND action_type::text <> 'system_event';

-- Bulk-complete stale system_event milestones (they should have auto-fired).
UPDATE public.timeline_milestones
SET status = 'complete', completed_at = NOW()
WHERE action_type = 'system_event'
  AND status = 'upcoming'
  AND due_date < CURRENT_DATE;