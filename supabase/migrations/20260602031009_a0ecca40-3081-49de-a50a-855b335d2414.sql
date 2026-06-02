-- Audit log of every Postmark send attempt.
CREATE TABLE public.email_sends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  to_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  template_key TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  invoice_id UUID,
  postmark_message_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  error_code TEXT,
  tag TEXT,
  metadata JSONB,
  raw_response JSONB,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_sends_client ON public.email_sends(client_id);
CREATE INDEX idx_email_sends_invoice ON public.email_sends(invoice_id);
CREATE INDEX idx_email_sends_sent_at ON public.email_sends(sent_at DESC);
CREATE INDEX idx_email_sends_status ON public.email_sends(status);

GRANT SELECT ON public.email_sends TO authenticated;
GRANT ALL ON public.email_sends TO service_role;

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

-- Owner reads everything.
CREATE POLICY "Owner reads all email_sends"
  ON public.email_sends FOR SELECT
  USING (public.has_role(auth.uid(), 'owner'));

-- Manager / associate reads only sends tied to their assigned clients.
CREATE POLICY "Studio reads email_sends for assigned clients"
  ON public.email_sends FOR SELECT
  USING (
    public.is_studio_user(auth.uid())
    AND client_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = email_sends.client_id
        AND (c.manager_id = auth.uid() OR c.photographer_id = auth.uid())
    )
  );

-- No INSERT/UPDATE/DELETE policies — only service_role can write.
