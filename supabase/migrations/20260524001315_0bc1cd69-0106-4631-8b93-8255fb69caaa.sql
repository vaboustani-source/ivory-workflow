
-- Test harness for B4 verification
CREATE TABLE IF NOT EXISTS public._b4_test_results (
  id serial PRIMARY KEY,
  scenario text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A helper that invokes add_quote_item / approve / reject under a chosen "actor".
-- It does this by bypassing auth.uid() — we directly call the inner machinery
-- and pass actor explicitly where the function supports it. For add_quote_item
-- we can't change auth.uid() server-side, so we replicate its decision logic
-- by branching on the actor's role and either calling _apply_post_booking_add
-- directly (owner-direct) or inserting a pending_changes row + notifying
-- (manager-proposes), mirroring add_quote_item exactly.
CREATE OR REPLACE FUNCTION public._b4_test_add_as(
  p_actor uuid,
  p_quote_id uuid,
  p_service_item_id uuid,
  p_quantity numeric,
  p_custom_description text,
  p_custom_price_cents int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_unit_price int;
  v_line_total int;
  v_desc text;
  v_is_owner boolean := public.is_owner(p_actor);
  v_is_manager boolean := public.is_studio_manager(p_actor);
  v_before jsonb;
  v_projected jsonb;
  v_pending_id uuid;
  v_apply jsonb;
  v_item public.service_items%ROWTYPE;
  v_qty numeric := COALESCE(p_quantity, 1);
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF p_service_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.service_items WHERE id = p_service_item_id;
    v_desc := COALESCE(p_custom_description, v_item.name);
    v_unit_price := COALESCE(p_custom_price_cents, v_item.price_cents);
  ELSE
    v_desc := p_custom_description;
    v_unit_price := COALESCE(p_custom_price_cents, 0);
  END IF;
  v_line_total := ROUND(v_unit_price * v_qty)::int;

  -- Mirror add_quote_item's gate:
  IF v_quote.status::text = 'accepted' AND v_line_total > 0 AND v_is_manager AND NOT v_is_owner THEN
    v_before := public._snapshot_quote_financials(p_quote_id);
    v_projected := public._preview_post_booking_add(
      p_quote_id, p_service_item_id, v_qty, p_custom_description, p_custom_price_cents
    );
    INSERT INTO public.pending_changes (
      client_id, quote_id, proposed_by, proposed_by_role, change_type,
      payload, before_snapshot, projected_after, status
    ) VALUES (
      v_quote.client_id, p_quote_id, p_actor, 'studio_manager', 'post_booking_add',
      jsonb_build_object(
        'service_item_id', p_service_item_id, 'quantity', v_qty,
        'custom_description', p_custom_description, 'custom_price_cents', p_custom_price_cents,
        'display_order', 0, 'resolved_description', v_desc, 'resolved_line_total_cents', v_line_total
      ),
      v_before, v_projected, 'pending'
    ) RETURNING id INTO v_pending_id;
    PERFORM public._notify_all_owners(
      'pricing_change.proposed',
      'Pricing change proposed',
      'Manager proposed: ' || v_desc,
      '/studio/approval-queue?tab=pricing'
    );
    PERFORM public._log_activity(
      'pricing_change.proposed', 'pending_change', v_pending_id,
      'Proposed post-booking add: ' || v_desc, p_actor,
      jsonb_build_object('client_id', v_quote.client_id, 'quote_id', p_quote_id, 'line_total_cents', v_line_total)
    );
    RETURN jsonb_build_object('quote_item_id', NULL, 'proposed', true, 'pending_change_id', v_pending_id);
  END IF;

  IF v_quote.status::text = 'accepted' AND v_line_total > 0 THEN
    v_apply := public._apply_post_booking_add(
      p_quote_id, p_service_item_id, v_qty, p_custom_description, p_custom_price_cents, 0, p_actor
    );
    RETURN jsonb_build_object('quote_item_id', v_apply->>'quote_item_id', 'proposed', false, 'distribution', v_apply->'distribution');
  END IF;

  -- (Not exercised in tests; pre-booking path) just return zero.
  RETURN jsonb_build_object('quote_item_id', NULL, 'proposed', false, 'skipped', true);
END $$;

-- Approve/reject wrappers that bypass the auth.uid() owner check.
CREATE OR REPLACE FUNCTION public._b4_test_approve_as(
  p_actor uuid, p_pending_id uuid, p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pc public.pending_changes%ROWTYPE;
  v_current_before jsonb;
  v_apply jsonb;
  v_payload jsonb;
BEGIN
  IF NOT public.is_owner(p_actor) THEN
    RAISE EXCEPTION 'test: actor is not owner';
  END IF;
  SELECT * INTO v_pc FROM public.pending_changes WHERE id = p_pending_id FOR UPDATE;
  IF v_pc.status <> 'pending' THEN RAISE EXCEPTION 'not pending'; END IF;

  v_current_before := public._snapshot_quote_financials(v_pc.quote_id);
  IF NOT p_force AND (
       (v_current_before->>'quote_total_cents') IS DISTINCT FROM (v_pc.before_snapshot->>'quote_total_cents')
    OR (v_current_before->'installments')::text IS DISTINCT FROM (v_pc.before_snapshot->'installments')::text
  ) THEN
    RETURN jsonb_build_object(
      'stale', true, 'applied', false,
      'stored_quote_total', v_pc.before_snapshot->>'quote_total_cents',
      'current_quote_total', v_current_before->>'quote_total_cents'
    );
  END IF;

  v_payload := v_pc.payload;
  v_apply := public._apply_post_booking_add(
    v_pc.quote_id,
    NULLIF(v_payload->>'service_item_id','')::uuid,
    COALESCE((v_payload->>'quantity')::numeric, 1),
    NULLIF(v_payload->>'custom_description',''),
    NULLIF(v_payload->>'custom_price_cents','')::int,
    COALESCE((v_payload->>'display_order')::int, 0),
    v_pc.proposed_by
  );
  UPDATE public.pending_changes
     SET status = 'approved', resolved_at = now(), resolved_by = p_actor
   WHERE id = p_pending_id;
  PERFORM public._notify(v_pc.proposed_by, 'pricing_change.approved', 'Approved', NULL, NULL);
  PERFORM public._log_activity(
    'pricing_change.approved', 'pending_change', p_pending_id,
    'Approved' || CASE WHEN p_force THEN ' (force)' ELSE '' END, p_actor,
    jsonb_build_object('client_id', v_pc.client_id, 'forced', p_force)
  );
  RETURN jsonb_build_object('stale', false, 'applied', true, 'distribution', v_apply->'distribution');
END $$;

CREATE OR REPLACE FUNCTION public._b4_test_reject_as(
  p_actor uuid, p_pending_id uuid, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pc public.pending_changes%ROWTYPE;
BEGIN
  IF NOT public.is_owner(p_actor) THEN RAISE EXCEPTION 'not owner'; END IF;
  SELECT * INTO v_pc FROM public.pending_changes WHERE id = p_pending_id FOR UPDATE;
  IF v_pc.status <> 'pending' THEN RAISE EXCEPTION 'not pending'; END IF;
  UPDATE public.pending_changes
     SET status='rejected', resolved_at=now(), resolved_by=p_actor, owner_response_note=p_note
   WHERE id = p_pending_id;
  PERFORM public._notify(v_pc.proposed_by, 'pricing_change.rejected', 'Rejected', p_note, NULL);
  PERFORM public._log_activity('pricing_change.rejected','pending_change',p_pending_id,'Rejected: ' || COALESCE(p_note,''), p_actor, '{}'::jsonb);
  RETURN jsonb_build_object('rejected', true);
END $$;
