
-- Test B: shift wedding date +30 days
UPDATE public.clients
SET wedding_date = wedding_date + INTERVAL '30 days'
WHERE id = '9ad04193-fbea-4271-a1ac-571a270cb34d';

-- Test C: activate album workflow
UPDATE public.clients
SET album_workflow_active = true
WHERE id = '9ad04193-fbea-4271-a1ac-571a270cb34d';
