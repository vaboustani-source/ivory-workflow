
ALTER TYPE public.workflow_branch ADD VALUE IF NOT EXISTS 'has_album_active';
ALTER TYPE public.workflow_branch ADD VALUE IF NOT EXISTS 'NOT_has_album_purchased';
ALTER TYPE public.workflow_trigger_relative ADD VALUE IF NOT EXISTS 'proposal_valid_until';
ALTER TYPE public.workflow_trigger_relative ADD VALUE IF NOT EXISTS 'album_workflow_activated_at';
