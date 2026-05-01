ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_content_tsv
  ON public.messages USING gin(content_tsv);