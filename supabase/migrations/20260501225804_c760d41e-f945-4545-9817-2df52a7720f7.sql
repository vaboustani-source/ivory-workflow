CREATE INDEX IF NOT EXISTS idx_contracts_client_status ON public.contracts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_questionnaires_client_status ON public.questionnaires(client_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_client_status ON public.proposals(client_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_status ON public.invoices(client_id, status);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON public.contract_signatures(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_client ON public.contract_signatures(client_id);