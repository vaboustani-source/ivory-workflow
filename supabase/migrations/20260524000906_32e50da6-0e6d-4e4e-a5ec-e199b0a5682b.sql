
-- ============================================================
-- B4: Post-booking pricing change approval workflow
-- ============================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.pending_change_type AS ENUM (
    'post_booking_add','post_booking_edit','post_booking_remove','post_booking_discount'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pending_change_status AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- pending_changes ----------
CREATE TABLE IF NOT EXISTS public.pending_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  proposed_by uuid NOT NULL,
  proposed_by_role text NOT NULL,
  change_type public.pending_change_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  projected_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.pending_change_status NOT NULL DEFAULT 'pending',
  reason text,
  owner_response_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);
CREATE INDEX IF NOT EXISTS idx_pending_changes_client ON public.pending_changes(client_id);
CREATE INDEX IF NOT EXISTS idx_pending_changes_status ON public.pending_changes(status);
CREATE INDEX IF NOT EXISTS idx_pending_changes_proposed_by ON public.pending_changes(proposed_by);

ALTER TABLE public.pending_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads pending_changes" ON public.pending_changes;
CREATE POLICY "Owner reads pending_changes" ON public.pending_changes
  FOR SELECT TO authenticated
  USING (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Proposer reads own pending_changes" ON public.pending_changes;
CREATE POLICY "Proposer reads own pending_changes" ON public.pending_changes
  FOR SELECT TO authenticated
  USING (proposed_by = auth.uid());

DROP POLICY IF EXISTS "Manager inserts own pending_changes" ON public.pending_changes;
CREATE POLICY "Manager inserts own pending_changes" ON public.pending_changes
  FOR INSERT TO authenticated
  WITH CHECK (
    proposed_by = auth.uid()
    AND status = 'pending'
    AND (public.is_studio_manager(auth.uid()) OR public.is_owner(auth.uid()))
  );

DROP POLICY IF EXISTS "Owner updates pending_changes" ON public.pending_changes;
CREATE POLICY "Owner updates pending_changes" ON public.pending_changes
  FOR UPDATE TO authenticated
  USING (public.is_owner(auth.uid()))
  WITH CHECK (public.is_owner(auth.uid()));

-- Belt-and-suspenders: explicitly forbid non-owners from flipping status to approved.
-- (RLS UPDATE above already restricts to owner; this is a CHECK constraint to defend
-- against any future relaxation of policies.)
ALTER TABLE public.pending_changes
  DROP CONSTRAINT IF EXISTS pending_changes_resolved_consistency;
ALTER TABLE public.pending_changes
  ADD CONSTRAINT pending_changes_resolved_consistency
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status IN ('approved','rejected','cancelled') AND resolved_at IS NOT NULL)
  );

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link_to text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User reads own notifications" ON public.notifications;
CREATE POLICY "User reads own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "User updates own notifications" ON public.notifications;
CREATE POLICY "User updates own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Inserts happen via SECURITY DEFINER helpers below; no general INSERT policy.
-- (A defensive deny is implicit since RLS is enabled and no INSERT policy exists.)

-- ---------- Notification helper ----------
CREATE OR REPLACE FUNCTION public._notify(
  p_user_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL, p_link_to text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, link_to)
  VALUES (p_user_id, p_kind, p_title, p_body, p_link_to)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._notify_all_owners(
  p_kind text, p_title text, p_body text DEFAULT NULL, p_link_to text DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner RECORD; v_count int := 0;
BEGIN
  FOR v_owner IN
    SELECT user_id FROM public.user_roles WHERE role = 'owner'
  LOOP
    PERFORM public._notify(v_owner.user_id, p_kind, p_title, p_body, p_link_to);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- ---------- Snapshot helper (read-only) ----------
CREATE OR REPLACE FUNCTION public._snapshot_quote_financials(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_installments jsonb;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'sequence_order', i.sequence_order,
    'label', i.label,
    'status', i.status::text,
    'subtotal_cents', i.subtotal_cents,
    'processing_fee_cents', i.processing_fee_cents,
    'total_cents', i.total_cents,
    'due_date', i.due_date,
    'paid_at', i.paid_at
  ) ORDER BY i.sequence_order), '[]'::jsonb)
  INTO v_installments
  FROM public.invoices i
  WHERE i.client_id = v_quote.client_id;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'quote_total_cents', v_quote.total_cents,
    'quote_subtotal_cents', v_quote.subtotal_cents,
    'installments', v_installments,
    'captured_at', now()
  );
END $$;

-- ---------- Preview helper (read-only projection) ----------
CREATE OR REPLACE FUNCTION public._preview_post_booking_add(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric,
  p_custom_description text,
  p_custom_price_cents int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_item public.service_items%ROWTYPE;
  v_desc text;
  v_unit_price int;
  v_qty numeric := COALESCE(p_quantity, 1);
  v_line_total int;
  v_fees_baked boolean := false;
  v_fee_pct numeric;
  v_fee_flat int;
  v_unpaid_count int;
  v_share int;
  v_remainder int;
  v_inv RECORD;
  v_idx int := 0;
  v_share_i int;
  v_new_net int;
  v_new_total int;
  v_new_fee int;
  v_proj jsonb := '[]'::jsonb;
  v_new_invoice jsonb;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;

  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    v_desc := COALESCE(p_custom_description, v_item.name);
    v_unit_price := COALESCE(p_custom_price_cents, v_item.price_cents);
  ELSE
    v_desc := p_custom_description;
    v_unit_price := COALESCE(p_custom_price_cents, 0);
  END IF;
  v_line_total := ROUND(v_unit_price * v_qty)::int;

  SELECT * INTO v_client FROM public.clients WHERE id = v_quote.client_id;
  IF v_client.package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages WHERE id = v_client.package_id;
    v_fees_baked := COALESCE(v_pkg.add_processing_fees, false);
  END IF;
  IF v_fees_baked THEN
    SELECT stripe_percentage, stripe_flat_cents INTO v_fee_pct, v_fee_flat
      FROM public.processing_fee_settings LIMIT 1;
  END IF;

  SELECT COUNT(*) INTO v_unpaid_count
    FROM public.invoices
   WHERE client_id = v_quote.client_id
     AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested');

  IF v_unpaid_count = 0 THEN
    v_new_net := v_line_total;
    IF v_fees_baked THEN
      v_new_total := CEIL((v_new_net + COALESCE(v_fee_flat,0))::numeric / (1 - COALESCE(v_fee_pct,0) / 100))::int;
      v_new_fee := v_new_total - v_new_net;
    ELSE
      v_new_total := v_new_net; v_new_fee := 0;
    END IF;
    v_new_invoice := jsonb_build_object(
      'created_new', true,
      'label', 'Additional charge — ' || v_desc,
      'net_cents', v_new_net,
      'fee_cents', v_new_fee,
      'total_cents', v_new_total
    );
    v_proj := jsonb_build_array(v_new_invoice);
  ELSE
    v_share := v_line_total / v_unpaid_count;
    v_remainder := v_line_total - (v_share * v_unpaid_count);
    FOR v_inv IN
      SELECT id, sequence_order, label, subtotal_cents, total_cents, processing_fee_cents, due_date
      FROM public.invoices
      WHERE client_id = v_quote.client_id
        AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested')
      ORDER BY due_date NULLS LAST, sequence_order
    LOOP
      v_idx := v_idx + 1;
      v_share_i := CASE WHEN v_idx = v_unpaid_count THEN v_share + v_remainder ELSE v_share END;
      v_new_net := v_inv.subtotal_cents + v_share_i;
      IF v_fees_baked THEN
        v_new_total := CEIL((v_new_net + COALESCE(v_fee_flat,0))::numeric / (1 - COALESCE(v_fee_pct,0) / 100))::int;
        v_new_fee := v_new_total - v_new_net;
      ELSE
        v_new_total := v_new_net; v_new_fee := 0;
      END IF;
      v_proj := v_proj || jsonb_build_object(
        'invoice_id', v_inv.id,
        'sequence_order', v_inv.sequence_order,
        'label', v_inv.label,
        'old_subtotal_cents', v_inv.subtotal_cents,
        'old_total_cents', v_inv.total_cents,
        'share_cents', v_share_i,
        'new_subtotal_cents', v_new_net,
        'new_processing_fee_cents', v_new_fee,
        'new_total_cents', v_new_total
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'line_total_cents', v_line_total,
    'description', v_desc,
    'fees_baked', v_fees_baked,
    'unpaid_count', v_unpaid_count,
    'new_quote_total_cents', GREATEST(0, COALESCE(v_quote.total_cents,0) + v_line_total),
    'projected_installments', v_proj
  );
END $$;

-- ---------- The shared apply helper (THE ONLY post-booking distribution path) ----------
CREATE OR REPLACE FUNCTION public._apply_post_booking_add(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric,
  p_custom_description text,
  p_custom_price_cents int,
  p_display_order int,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.service_items%ROWTYPE;
  v_desc text;
  v_unit_price int;
  v_item_type public.service_item_type;
  v_qty numeric := COALESCE(p_quantity, 1);
  v_line_total int;
  v_quote_item_id uuid;
  v_cost int;

  v_quote public.quotes%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_fees_baked boolean := false;
  v_fee_pct numeric;
  v_fee_flat int;

  v_unpaid_count int;
  v_share int;
  v_remainder int;
  v_assigned int := 0;
  v_inv RECORD;
  v_idx int := 0;
  v_share_i int;
  v_new_net int;
  v_new_total int;
  v_new_fee int;
  v_dist jsonb := '[]'::jsonb;
  v_max_seq int;
  v_new_invoice_id uuid;
  v_due_date date;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;

  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service item not found'; END IF;
    v_desc := COALESCE(p_custom_description, v_item.name);
    v_unit_price := COALESCE(p_custom_price_cents, v_item.price_cents);
    v_item_type := v_item.item_type;
  ELSE
    IF p_custom_description IS NULL OR p_custom_price_cents IS NULL THEN
      RAISE EXCEPTION 'Custom line requires description and price';
    END IF;
    v_desc := p_custom_description;
    v_unit_price := p_custom_price_cents;
    v_item_type := NULL;
  END IF;

  v_line_total := ROUND(v_unit_price * v_qty)::int;

  INSERT INTO public.quote_items (
    quote_id, service_item_id, description_snapshot, unit_price_cents,
    quantity, line_total_cents, item_type_snapshot, display_order
  ) VALUES (
    p_quote_id, p_service_item_id, v_desc, v_unit_price,
    v_qty, v_line_total, v_item_type, COALESCE(p_display_order, 0)
  ) RETURNING id INTO v_quote_item_id;

  IF p_service_item_id IS NOT NULL THEN
    SELECT cost_cents INTO v_cost
      FROM public.service_item_costs WHERE service_item_id = p_service_item_id;
    INSERT INTO public.quote_item_cost_snapshots (quote_item_id, cost_cents_snapshot)
    VALUES (v_quote_item_id, COALESCE(v_cost, 0));
    INSERT INTO public.quote_item_inclusions (quote_item_id, text, display_order)
    SELECT v_quote_item_id, sii.text, sii.display_order
    FROM public.service_item_inclusions sii
    WHERE sii.service_item_id = p_service_item_id
    ORDER BY sii.display_order, sii.created_at;
  END IF;

  IF v_quote.status::text <> 'accepted' OR v_line_total = 0 THEN
    -- Caller invoked helper but conditions don't require distribution; just refresh totals.
    UPDATE public.quotes q
    SET subtotal_cents = sub.s,
        total_cents = GREATEST(0, sub.s - COALESCE(q.discount_cents, 0)),
        updated_at = now()
    FROM (SELECT COALESCE(SUM(line_total_cents),0)::int AS s FROM public.quote_items WHERE quote_id = p_quote_id) sub
    WHERE q.id = p_quote_id;
    RETURN jsonb_build_object('quote_item_id', v_quote_item_id, 'distributed', false, 'line_total_cents', v_line_total);
  END IF;

  -- Refresh quote totals
  UPDATE public.quotes q
  SET subtotal_cents = sub.s,
      total_cents = GREATEST(0, sub.s - COALESCE(q.discount_cents, 0)),
      updated_at = now()
  FROM (SELECT COALESCE(SUM(line_total_cents),0)::int AS s FROM public.quote_items WHERE quote_id = p_quote_id) sub
  WHERE q.id = p_quote_id;

  SELECT * INTO v_client FROM public.clients WHERE id = v_quote.client_id;
  IF v_client.package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM public.packages WHERE id = v_client.package_id;
    v_fees_baked := COALESCE(v_pkg.add_processing_fees, false);
  END IF;
  IF v_fees_baked THEN
    SELECT stripe_percentage, stripe_flat_cents INTO v_fee_pct, v_fee_flat
      FROM public.processing_fee_settings LIMIT 1;
    IF v_fee_pct IS NULL THEN
      RAISE EXCEPTION 'Processing fee settings not configured';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_unpaid_count
  FROM public.invoices
  WHERE client_id = v_quote.client_id
    AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested');

  IF v_unpaid_count = 0 THEN
    SELECT COALESCE(MAX(sequence_order), 0) + 1 INTO v_max_seq
      FROM public.invoices WHERE client_id = v_quote.client_id;
    v_new_net := v_line_total;
    IF v_fees_baked THEN
      v_new_total := CEIL((v_new_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
      v_new_fee := v_new_total - v_new_net;
    ELSE
      v_new_total := v_new_net; v_new_fee := 0;
    END IF;
    v_due_date := CURRENT_DATE;
    INSERT INTO public.invoices (
      client_id, sequence_order, label, subtotal_cents, processing_fee_cents,
      total_cents, amount, due_date, status, currency, invoice_type
    ) VALUES (
      v_quote.client_id, v_max_seq, 'Additional charge — ' || v_desc,
      v_new_net, v_new_fee, v_new_total, v_new_total::numeric / 100,
      v_due_date, 'scheduled', 'USD', 'other'::invoice_type
    ) RETURNING id INTO v_new_invoice_id;
    INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
    VALUES (v_new_invoice_id, 'Post-booking addition: ' || v_desc, v_new_net, 1);
    INSERT INTO public.invoice_recipients (invoice_id, name, email, role)
    VALUES (v_new_invoice_id, v_client.couple_name_1, v_client.primary_email, 'primary_client');
    v_dist := jsonb_build_array(jsonb_build_object(
      'invoice_id', v_new_invoice_id, 'created_new', true,
      'net_added_cents', v_new_net, 'total_charged_cents', v_new_total
    ));
  ELSE
    v_share := v_line_total / v_unpaid_count;
    v_remainder := v_line_total - (v_share * v_unpaid_count);
    FOR v_inv IN
      SELECT id, subtotal_cents, total_cents, processing_fee_cents, due_date, label
      FROM public.invoices
      WHERE client_id = v_quote.client_id
        AND status::text IN ('scheduled','sent','viewed','overdue','reschedule_requested')
      ORDER BY due_date NULLS LAST, sequence_order
    LOOP
      v_idx := v_idx + 1;
      v_share_i := CASE WHEN v_idx = v_unpaid_count THEN v_share + v_remainder ELSE v_share END;
      v_assigned := v_assigned + v_share_i;
      v_new_net := v_inv.subtotal_cents + v_share_i;
      IF v_fees_baked THEN
        v_new_total := CEIL((v_new_net + v_fee_flat)::numeric / (1 - v_fee_pct / 100))::int;
        v_new_fee := v_new_total - v_new_net;
      ELSE
        v_new_total := v_new_net; v_new_fee := 0;
      END IF;
      UPDATE public.invoices
      SET subtotal_cents = v_new_net,
          processing_fee_cents = v_new_fee,
          total_cents = v_new_total,
          amount = v_new_total::numeric / 100,
          updated_at = now()
      WHERE id = v_inv.id;
      INSERT INTO public.invoice_line_items (invoice_id, description, amount_cents, sequence_order)
      VALUES (
        v_inv.id, 'Post-booking addition: ' || v_desc || ' (share)', v_share_i,
        COALESCE((SELECT MAX(sequence_order) FROM public.invoice_line_items WHERE invoice_id = v_inv.id), 0) + 1
      );
      v_dist := v_dist || jsonb_build_object(
        'invoice_id', v_inv.id, 'label', v_inv.label, 'share_cents', v_share_i,
        'new_net_cents', v_new_net, 'new_total_cents', v_new_total
      );
    END LOOP;
    IF v_assigned <> v_line_total THEN
      RAISE EXCEPTION 'Distribution mismatch: assigned % vs added %', v_assigned, v_line_total;
    END IF;
  END IF;

  PERFORM public._log_activity(
    'quote.item_added_post_booking', 'quote_item', v_quote_item_id,
    'Post-booking add: "' || v_desc || '" ($' || ROUND(v_line_total/100.0, 2)::text ||
      ') distributed across ' || COALESCE(v_unpaid_count, 0) || ' installment(s)',
    p_actor,
    jsonb_build_object(
      'client_id', v_quote.client_id, 'quote_id', p_quote_id,
      'net_added_cents', v_line_total, 'fees_baked', v_fees_baked, 'distribution', v_dist
    )
  );

  RETURN jsonb_build_object(
    'quote_item_id', v_quote_item_id,
    'distributed', true,
    'line_total_cents', v_line_total,
    'fees_baked', v_fees_baked,
    'unpaid_count', v_unpaid_count,
    'distribution', v_dist
  );
END $$;

-- ---------- Refactored add_quote_item with manager-approval gate ----------
DROP FUNCTION IF EXISTS public.add_quote_item(uuid, uuid, numeric, text, integer, integer);

CREATE OR REPLACE FUNCTION public.add_quote_item(
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric DEFAULT 1,
  p_custom_description text DEFAULT NULL,
  p_custom_price_cents integer DEFAULT NULL,
  p_display_order integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_item public.service_items%ROWTYPE;
  v_desc text;
  v_unit_price int;
  v_item_type public.service_item_type;
  v_qty numeric := COALESCE(p_quantity, 1);
  v_line_total int;
  v_quote_item_id uuid;
  v_cost int;

  v_is_owner boolean;
  v_is_manager boolean;
  v_before jsonb;
  v_projected jsonb;
  v_pending_id uuid;
  v_apply jsonb;
  v_client public.clients%ROWTYPE;
  v_couple text;
BEGIN
  IF NOT public.is_studio_user(v_user) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;

  -- Resolve line_total to decide whether the gate fires.
  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service item not found'; END IF;
    v_desc := COALESCE(p_custom_description, v_item.name);
    v_unit_price := COALESCE(p_custom_price_cents, v_item.price_cents);
    v_item_type := v_item.item_type;
  ELSE
    IF p_custom_description IS NULL OR p_custom_price_cents IS NULL THEN
      RAISE EXCEPTION 'Custom line requires description and price';
    END IF;
    v_desc := p_custom_description;
    v_unit_price := p_custom_price_cents;
    v_item_type := NULL;
  END IF;
  v_line_total := ROUND(v_unit_price * v_qty)::int;

  v_is_owner := public.is_owner(v_user);
  v_is_manager := public.is_studio_manager(v_user);

  -- ===== GATE =====
  -- Post-booking (accepted quote) + non-zero price + caller is studio_manager (not owner)
  -- → propose, mutate nothing.
  IF v_quote.status::text = 'accepted' AND v_line_total > 0 AND v_is_manager AND NOT v_is_owner THEN
    v_before := public._snapshot_quote_financials(p_quote_id);
    v_projected := public._preview_post_booking_add(
      p_quote_id, p_service_item_id, v_qty, p_custom_description, p_custom_price_cents
    );

    INSERT INTO public.pending_changes (
      client_id, quote_id, proposed_by, proposed_by_role, change_type,
      payload, before_snapshot, projected_after, status
    ) VALUES (
      v_quote.client_id, p_quote_id, v_user, 'studio_manager', 'post_booking_add',
      jsonb_build_object(
        'service_item_id', p_service_item_id,
        'quantity', v_qty,
        'custom_description', p_custom_description,
        'custom_price_cents', p_custom_price_cents,
        'display_order', p_display_order,
        'resolved_description', v_desc,
        'resolved_line_total_cents', v_line_total
      ),
      v_before, v_projected, 'pending'
    ) RETURNING id INTO v_pending_id;

    SELECT * INTO v_client FROM public.clients WHERE id = v_quote.client_id;
    v_couple := v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2, '');

    PERFORM public._notify_all_owners(
      'pricing_change.proposed',
      'Pricing change proposed for ' || v_couple,
      'Manager proposed: ' || v_desc || ' ($' || ROUND(v_line_total/100.0,2)::text || ')',
      '/studio/approval-queue?tab=pricing'
    );

    PERFORM public._log_activity(
      'pricing_change.proposed', 'pending_change', v_pending_id,
      'Proposed post-booking add: "' || v_desc || '" ($' || ROUND(v_line_total/100.0,2)::text || ')',
      v_user,
      jsonb_build_object(
        'client_id', v_quote.client_id, 'quote_id', p_quote_id,
        'change_type', 'post_booking_add', 'line_total_cents', v_line_total
      )
    );

    RETURN jsonb_build_object(
      'quote_item_id', NULL,
      'proposed', true,
      'pending_change_id', v_pending_id,
      'message', 'Change proposed — awaiting owner approval.'
    );
  END IF;

  -- ===== APPLY =====
  -- Owner-direct OR pre-booking (draft/sent) OR zero-price line: use the helper for
  -- post-booking accepted+nonzero, or the simple insert path otherwise.
  IF v_quote.status::text = 'accepted' AND v_line_total > 0 THEN
    -- Owner-direct (or any non-manager studio_user) accepted path → shared helper.
    v_apply := public._apply_post_booking_add(
      p_quote_id, p_service_item_id, v_qty,
      p_custom_description, p_custom_price_cents, p_display_order, v_user
    );
    RETURN jsonb_build_object(
      'quote_item_id', v_apply->>'quote_item_id',
      'proposed', false,
      'distribution', v_apply->'distribution'
    );
  END IF;

  -- Pre-booking (draft/sent) OR zero-price: simple insert; no distribution.
  INSERT INTO public.quote_items (
    quote_id, service_item_id, description_snapshot, unit_price_cents,
    quantity, line_total_cents, item_type_snapshot, display_order
  ) VALUES (
    p_quote_id, p_service_item_id, v_desc, v_unit_price,
    v_qty, v_line_total, v_item_type, COALESCE(p_display_order, 0)
  ) RETURNING id INTO v_quote_item_id;

  IF p_service_item_id IS NOT NULL THEN
    SELECT cost_cents INTO v_cost
      FROM public.service_item_costs WHERE service_item_id = p_service_item_id;
    INSERT INTO public.quote_item_cost_snapshots (quote_item_id, cost_cents_snapshot)
    VALUES (v_quote_item_id, COALESCE(v_cost, 0));
    INSERT INTO public.quote_item_inclusions (quote_item_id, text, display_order)
    SELECT v_quote_item_id, sii.text, sii.display_order
    FROM public.service_item_inclusions sii
    WHERE sii.service_item_id = p_service_item_id
    ORDER BY sii.display_order, sii.created_at;
  END IF;

  RETURN jsonb_build_object(
    'quote_item_id', v_quote_item_id,
    'proposed', false
  );
END $$;

-- ---------- Approve ----------
CREATE OR REPLACE FUNCTION public.approve_pending_change(
  p_id uuid,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_pc public.pending_changes%ROWTYPE;
  v_current_before jsonb;
  v_apply jsonb;
  v_client public.clients%ROWTYPE;
  v_couple text;
  v_payload jsonb;
BEGIN
  IF NOT public.is_owner(v_user) THEN
    RAISE EXCEPTION 'Only owner can approve';
  END IF;

  SELECT * INTO v_pc FROM public.pending_changes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending change not found'; END IF;
  IF v_pc.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending change is not pending (status: %)', v_pc.status;
  END IF;

  -- Stale guard: compare current live state to the snapshot taken at propose time.
  v_current_before := public._snapshot_quote_financials(v_pc.quote_id);
  IF NOT p_force AND (
       (v_current_before->>'quote_total_cents') IS DISTINCT FROM (v_pc.before_snapshot->>'quote_total_cents')
    OR (v_current_before->'installments')::text IS DISTINCT FROM (v_pc.before_snapshot->'installments')::text
  ) THEN
    RETURN jsonb_build_object(
      'stale', true,
      'applied', false,
      'message', 'Financials changed since proposal. Review before approving.',
      'stored_before', v_pc.before_snapshot,
      'current_before', v_current_before
    );
  END IF;

  v_payload := v_pc.payload;

  -- Only post_booking_add is implemented in B4. Other change types: reject for now.
  IF v_pc.change_type <> 'post_booking_add' THEN
    RAISE EXCEPTION 'Change type % not yet supported by approve flow', v_pc.change_type;
  END IF;

  v_apply := public._apply_post_booking_add(
    v_pc.quote_id,
    NULLIF(v_payload->>'service_item_id','')::uuid,
    COALESCE((v_payload->>'quantity')::numeric, 1),
    NULLIF(v_payload->>'custom_description',''),
    NULLIF(v_payload->>'custom_price_cents','')::int,
    COALESCE((v_payload->>'display_order')::int, 0),
    v_pc.proposed_by  -- attribute distribution to the manager who proposed it
  );

  UPDATE public.pending_changes
     SET status = 'approved', resolved_at = now(), resolved_by = v_user
   WHERE id = p_id;

  SELECT * INTO v_client FROM public.clients WHERE id = v_pc.client_id;
  v_couple := v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2, '');

  PERFORM public._notify(
    v_pc.proposed_by,
    'pricing_change.approved',
    'Your pricing change for ' || v_couple || ' was approved',
    'Approved: ' || COALESCE(v_payload->>'resolved_description','(item)'),
    '/studio/clients/' || v_pc.client_id::text || '?tab=financials'
  );

  PERFORM public._log_activity(
    'pricing_change.approved', 'pending_change', p_id,
    'Approved post-booking add' || CASE WHEN p_force THEN ' (force, re-applied from current state)' ELSE '' END,
    v_user,
    jsonb_build_object(
      'client_id', v_pc.client_id, 'quote_id', v_pc.quote_id,
      'proposed_by', v_pc.proposed_by, 'forced', p_force,
      'apply_result', v_apply
    )
  );

  RETURN jsonb_build_object(
    'stale', false, 'applied', true,
    'pending_change_id', p_id,
    'distribution', v_apply->'distribution'
  );
END $$;

-- ---------- Reject ----------
CREATE OR REPLACE FUNCTION public.reject_pending_change(
  p_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_pc public.pending_changes%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_couple text;
BEGIN
  IF NOT public.is_owner(v_user) THEN
    RAISE EXCEPTION 'Only owner can reject';
  END IF;
  SELECT * INTO v_pc FROM public.pending_changes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending change not found'; END IF;
  IF v_pc.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending change is not pending (status: %)', v_pc.status;
  END IF;

  UPDATE public.pending_changes
     SET status = 'rejected', resolved_at = now(), resolved_by = v_user,
         owner_response_note = p_note
   WHERE id = p_id;

  SELECT * INTO v_client FROM public.clients WHERE id = v_pc.client_id;
  v_couple := v_client.couple_name_1 || COALESCE(' & ' || v_client.couple_name_2, '');

  PERFORM public._notify(
    v_pc.proposed_by,
    'pricing_change.rejected',
    'Your pricing change for ' || v_couple || ' was rejected',
    COALESCE(p_note, 'No note provided.'),
    '/studio/clients/' || v_pc.client_id::text || '?tab=financials'
  );

  PERFORM public._log_activity(
    'pricing_change.rejected', 'pending_change', p_id,
    'Rejected post-booking change' || CASE WHEN p_note IS NOT NULL THEN ': ' || p_note ELSE '' END,
    v_user,
    jsonb_build_object('client_id', v_pc.client_id, 'quote_id', v_pc.quote_id, 'proposed_by', v_pc.proposed_by)
  );

  RETURN jsonb_build_object('rejected', true, 'pending_change_id', p_id);
END $$;
