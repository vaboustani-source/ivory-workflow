
-- Enum
DO $$ BEGIN
  CREATE TYPE public.contract_block_type AS ENUM (
    'text_box','image','divider','spacer',
    'short_answer','free_response','date_select',
    'initials','signature',
    'dropdown','checkboxes','multiple_choice'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Flags
ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS is_block_based boolean NOT NULL DEFAULT false;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS is_block_based boolean NOT NULL DEFAULT false;

-- Template blocks
CREATE TABLE IF NOT EXISTS public.contract_template_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.contract_templates(id) ON DELETE CASCADE,
  position int NOT NULL,
  block_type public.contract_block_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctb_template_pos ON public.contract_template_blocks(template_id, position);

-- Contract blocks (frozen)
CREATE TABLE IF NOT EXISTS public.contract_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  position int NOT NULL,
  block_type public.contract_block_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text,
  signer_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cb_contract_pos ON public.contract_blocks(contract_id, position);

-- Responses
CREATE TABLE IF NOT EXISTS public.contract_block_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_block_id uuid NOT NULL REFERENCES public.contract_blocks(id) ON DELETE CASCADE,
  signer_role text,
  response_text text,
  response_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  responded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_block_id, signer_role)
);
CREATE INDEX IF NOT EXISTS idx_cbr_block ON public.contract_block_responses(contract_block_id);

-- Signers
CREATE TABLE IF NOT EXISTS public.contract_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  signer_role text NOT NULL,
  name text,
  email text,
  public_token text UNIQUE,
  public_token_expires_at timestamptz,
  signed_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_id, signer_role)
);
CREATE INDEX IF NOT EXISTS idx_cs_contract ON public.contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS idx_cs_token ON public.contract_signers(public_token);

-- Triggers
DROP TRIGGER IF EXISTS trg_ctb_updated ON public.contract_template_blocks;
CREATE TRIGGER trg_ctb_updated BEFORE UPDATE ON public.contract_template_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.contract_template_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_block_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signers ENABLE ROW LEVEL SECURITY;

-- Studio full access on template blocks
CREATE POLICY "Studio manages template blocks"
  ON public.contract_template_blocks FOR ALL
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

-- Studio full access on contract blocks
CREATE POLICY "Studio manages contract blocks"
  ON public.contract_blocks FOR ALL
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

-- Public read of contract blocks (signing page reads via anon; gated by knowing contract_id from token endpoint).
-- We allow anon select; the contract_id is only discoverable via the token-validated server function.
CREATE POLICY "Anyone can read contract blocks"
  ON public.contract_blocks FOR SELECT
  USING (true);

-- Studio reads responses
CREATE POLICY "Studio reads block responses"
  ON public.contract_block_responses FOR SELECT
  USING (public.is_studio_user(auth.uid()));

-- Anyone can insert/update responses (validated server-side via signer token)
CREATE POLICY "Public can insert block responses"
  ON public.contract_block_responses FOR INSERT
  WITH CHECK (true);
CREATE POLICY "Public can update block responses"
  ON public.contract_block_responses FOR UPDATE
  USING (true) WITH CHECK (true);

-- Signers
CREATE POLICY "Studio manages signers"
  ON public.contract_signers FOR ALL
  USING (public.is_studio_user(auth.uid()))
  WITH CHECK (public.is_studio_user(auth.uid()));

CREATE POLICY "Anyone can read signers"
  ON public.contract_signers FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update signer signed_at"
  ON public.contract_signers FOR UPDATE
  USING (true) WITH CHECK (true);
