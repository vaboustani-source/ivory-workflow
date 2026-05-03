ALTER TABLE public.portrait_sequences
  ADD COLUMN IF NOT EXISTS couple_edits_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS couple_comments text;