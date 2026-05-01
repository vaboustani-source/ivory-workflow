-- contract_signatures: immutable signing records
CREATE TABLE IF NOT EXISTS public.contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  signed_by_user_id uuid NOT NULL REFERENCES public.profiles(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  typed_name text NOT NULL,
  agreed_to_terms boolean NOT NULL DEFAULT false,
  ip_address text,
  user_agent text,
  contract_version_hash text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, signed_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON public.contract_signatures(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_client ON public.contract_signatures(client_id);

ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio reads all signatures"
  ON public.contract_signatures FOR SELECT
  TO authenticated
  USING (public.is_studio_user(auth.uid()));

CREATE POLICY "Client reads own signatures"
  ON public.contract_signatures FOR SELECT
  TO authenticated
  USING (public.is_client_of(auth.uid(), client_id));

CREATE POLICY "Client inserts own signature"
  ON public.contract_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    signed_by_user_id = auth.uid()
    AND public.is_client_of(auth.uid(), client_id)
  );

-- Extend contracts
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS signature_required_role text NOT NULL DEFAULT 'partner_1';

-- Validate signature_required_role values via trigger (avoids check constraints per project conventions)
CREATE OR REPLACE FUNCTION public._validate_contract_signature_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.signature_required_role IS NOT NULL
     AND NEW.signature_required_role NOT IN ('partner_1','both_partners') THEN
    RAISE EXCEPTION 'signature_required_role must be partner_1 or both_partners';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_contract_signature_role ON public.contracts;
CREATE TRIGGER validate_contract_signature_role
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public._validate_contract_signature_role();

-- Extend questionnaires
ALTER TABLE public.questionnaires
  ADD COLUMN IF NOT EXISTS auto_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_after_submit boolean NOT NULL DEFAULT false;