
DO $$
DECLARE
  v_owner uuid := '15f705ca-8003-467d-8b38-48b1795a6ba3';
  v_manager uuid := '56fb7740-2dde-4d64-a565-3ddd0c0afd89';
  v_isabella_client uuid := 'e56b2344-62f3-4555-8e5b-68876bc56abe';
  v_isabella_quote uuid := '382056d1-2f62-4df3-aa17-255a51105428';
  v_sophia_client uuid := '9ad04193-fbea-4271-a1ac-571a270cb34d';
  v_sophia_quote uuid := 'af5a4623-c1cb-467d-b6de-7509e3a2ee6f';
  v_charlotte_client uuid := '9cae6928-4da2-4ef9-87bb-84e73abab5b0';
  v_charlotte_quote uuid := 'b9d79800-fdce-4d6a-99c2-86032866725c';

  v_res jsonb;
  v_pending_id uuid;
  v_pending_id_stale uuid;
  v_pending_id_reject uuid;
  v_before_isa jsonb;
  v_after_isa jsonb;
  v_before_sop jsonb;
  v_after_sop jsonb;
  v_before_cha jsonb;
  v_after_cha jsonb;
  v_stale_check jsonb;
  v_force_res jsonb;
  v_owner_direct_pending int;
  v_tmp_client uuid;
  v_tmp_quote uuid;
BEGIN
  TRUNCATE public._b4_test_results RESTART IDENTITY;

  -- ===== TEST 1: Manager proposes ($1,200, Isabella, no fees) =====
  v_before_isa := public._snapshot_quote_financials(v_isabella_quote);
  v_res := public._b4_test_add_as(v_manager, v_isabella_quote, NULL, 1, 'B4 #1: Manager propose', 120000);
  v_pending_id := (v_res->>'pending_change_id')::uuid;
  v_after_isa := public._snapshot_quote_financials(v_isabella_quote);
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 1 — Manager proposes on accepted quote (Isabella, no fees)',
    jsonb_build_object(
      'returned', v_res,
      'pending_change_exists', EXISTS(SELECT 1 FROM public.pending_changes WHERE id=v_pending_id AND status='pending'),
      'quote_total_unchanged', (v_after_isa->>'quote_total_cents')=(v_before_isa->>'quote_total_cents'),
      'installments_unchanged', (v_after_isa->'installments')::text = (v_before_isa->'installments')::text,
      'owner_was_notified', EXISTS(SELECT 1 FROM public.notifications WHERE user_id=v_owner AND kind='pricing_change.proposed'),
      'activity_log_proposed', EXISTS(SELECT 1 FROM public.activity_log WHERE action_type='pricing_change.proposed' AND target_id=v_pending_id),
      'expect', 'pending row created; quote/installments UNCHANGED; owner notified; activity logged'
    )
  );

  -- ===== TEST 2: Owner approves → shared helper fires; consistency ✓ =====
  v_before_isa := public._snapshot_quote_financials(v_isabella_quote);
  v_res := public._b4_test_approve_as(v_owner, v_pending_id, false);
  v_after_isa := public._snapshot_quote_financials(v_isabella_quote);
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 2 — Owner approves; shared helper distributes; consistency MATCHES',
    jsonb_build_object(
      'approve_result', v_res,
      'before_total', (v_before_isa->>'quote_total_cents')::int,
      'after_total', (v_after_isa->>'quote_total_cents')::int,
      'delta', (v_after_isa->>'quote_total_cents')::int - (v_before_isa->>'quote_total_cents')::int,
      'sum_unpaid_installments_subtotal', (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices WHERE client_id=v_isabella_client AND status::text NOT IN ('paid','cancelled','refunded','kill_fee')),
      'sum_all_installments_subtotal', (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices WHERE client_id=v_isabella_client),
      'quote_total_now', (SELECT total_cents FROM public.quotes WHERE id=v_isabella_quote),
      'consistency_check_unpaid_sum_eq_quote_total',
        (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices WHERE client_id=v_isabella_client) = (SELECT total_cents FROM public.quotes WHERE id=v_isabella_quote),
      'pending_status', (SELECT status FROM public.pending_changes WHERE id=v_pending_id),
      'activity_logged_approved', EXISTS(SELECT 1 FROM public.activity_log WHERE action_type='pricing_change.approved' AND target_id=v_pending_id),
      'activity_logged_post_booking_add', EXISTS(SELECT 1 FROM public.activity_log WHERE action_type='quote.item_added_post_booking' AND user_id=v_manager AND created_at > now() - interval '1 minute'),
      'manager_notified_approval', EXISTS(SELECT 1 FROM public.notifications WHERE user_id=v_manager AND kind='pricing_change.approved')
    )
  );

  -- ===== TEST 3: Owner REJECTS with note =====
  v_before_sop := public._snapshot_quote_financials(v_sophia_quote);
  v_res := public._b4_test_add_as(v_manager, v_sophia_quote, NULL, 1, 'B4 #3: Manager propose to reject', 50000);
  v_pending_id_reject := (v_res->>'pending_change_id')::uuid;
  v_res := public._b4_test_reject_as(v_owner, v_pending_id_reject, 'Not approved — discussed with couple.');
  v_after_sop := public._snapshot_quote_financials(v_sophia_quote);
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 3 — Owner rejects manager proposal with note',
    jsonb_build_object(
      'reject_result', v_res,
      'quote_total_unchanged', (v_before_sop->>'quote_total_cents')=(v_after_sop->>'quote_total_cents'),
      'installments_unchanged', (v_before_sop->'installments')::text = (v_after_sop->'installments')::text,
      'pending_status', (SELECT status FROM public.pending_changes WHERE id=v_pending_id_reject),
      'note_stored', (SELECT owner_response_note FROM public.pending_changes WHERE id=v_pending_id_reject),
      'manager_notified_rejection', EXISTS(SELECT 1 FROM public.notifications WHERE user_id=v_manager AND kind='pricing_change.rejected'),
      'activity_logged_rejected', EXISTS(SELECT 1 FROM public.activity_log WHERE action_type='pricing_change.rejected' AND target_id=v_pending_id_reject)
    )
  );

  -- ===== TEST 4: Owner-direct on Charlotte → no gate, applies immediately =====
  v_before_cha := public._snapshot_quote_financials(v_charlotte_quote);
  v_res := public._b4_test_add_as(v_owner, v_charlotte_quote, NULL, 1, 'B4 #4: Owner direct', 80000);
  v_after_cha := public._snapshot_quote_financials(v_charlotte_quote);
  v_owner_direct_pending := (SELECT COUNT(*) FROM public.pending_changes WHERE client_id=v_charlotte_client AND status='pending');
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 4 — Owner-direct post-booking add (ungated, applies immediately)',
    jsonb_build_object(
      'result', v_res,
      'no_pending_row_created', v_owner_direct_pending = 0,
      'before_total', (v_before_cha->>'quote_total_cents')::int,
      'after_total', (v_after_cha->>'quote_total_cents')::int,
      'delta', (v_after_cha->>'quote_total_cents')::int - (v_before_cha->>'quote_total_cents')::int,
      'consistency',
        (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices WHERE client_id=v_charlotte_client) = (SELECT total_cents FROM public.quotes WHERE id=v_charlotte_quote)
    )
  );

  -- ===== TEST 5: Manager builds DRAFT (pre-booking, ungated) =====
  -- Create throwaway client + draft quote (one quote per client constraint).
  INSERT INTO public.clients (couple_name_1, primary_email, status)
  VALUES ('B4Test', 'b4test+' || extract(epoch from now())::text || '@example.invalid', 'lead')
  RETURNING id INTO v_tmp_client;
  INSERT INTO public.quotes (client_id, status, subtotal_cents, total_cents)
  VALUES (v_tmp_client, 'draft', 0, 0)
  RETURNING id INTO v_tmp_quote;

  v_res := public._b4_test_add_as(v_manager, v_tmp_quote, NULL, 1, 'B4 #5: Manager DRAFT', 25000);

  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 5 — Manager builds DRAFT quote (NO approval gate)',
    jsonb_build_object(
      'result', v_res,
      'no_pending_created', NOT EXISTS(SELECT 1 FROM public.pending_changes WHERE quote_id=v_tmp_quote),
      'quote_item_created', EXISTS(SELECT 1 FROM public.quote_items WHERE quote_id=v_tmp_quote),
      'expect', 'quote_item created directly; NO pending row; pre-booking is ungated'
    )
  );

  -- Cleanup throwaway
  DELETE FROM public.quote_items WHERE quote_id = v_tmp_quote;
  DELETE FROM public.quotes WHERE id = v_tmp_quote;
  DELETE FROM public.clients WHERE id = v_tmp_client;

  -- ===== TEST 6: RLS verification — UPDATE policy owner-only =====
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 6 — RLS prevents non-owner from setting status=approved',
    jsonb_build_object(
      'update_policy_owner_only', EXISTS(
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='pending_changes' AND cmd='UPDATE'
          AND qual LIKE '%is_owner%' AND with_check LIKE '%is_owner%'
      ),
      'insert_policy_forces_pending_and_self', EXISTS(
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='pending_changes' AND cmd='INSERT'
          AND with_check LIKE '%status%pending%' AND with_check LIKE '%proposed_by%'
      ),
      'select_policies_present', (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='pending_changes' AND cmd='SELECT'),
      'expect', 'UPDATE restricted to is_owner; INSERT WITH CHECK forces status=pending AND proposed_by=auth.uid()'
    )
  );

  -- ===== TEST 7: STALE GUARD =====
  -- (a) Manager proposes on Isabella
  v_before_isa := public._snapshot_quote_financials(v_isabella_quote);
  v_res := public._b4_test_add_as(v_manager, v_isabella_quote, NULL, 1, 'B4 #7a: Manager propose pre-staleness', 60000);
  v_pending_id_stale := (v_res->>'pending_change_id')::uuid;

  -- (b) Owner does direct add → changes financials
  v_res := public._b4_test_add_as(v_owner, v_isabella_quote, NULL, 1, 'B4 #7b: Owner direct invalidating', 30000);

  -- (c) Owner tries to approve manager's proposal WITHOUT force → stale=true
  v_stale_check := public._b4_test_approve_as(v_owner, v_pending_id_stale, false);

  -- (d) Owner force-approves → re-applies from CURRENT state
  v_force_res := public._b4_test_approve_as(v_owner, v_pending_id_stale, true);

  v_after_isa := public._snapshot_quote_financials(v_isabella_quote);

  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'TEST 7 — Stale guard: propose → owner-direct change in between → approve',
    jsonb_build_object(
      'pending_id', v_pending_id_stale,
      'step_c_stale_flagged', (v_stale_check->>'stale')::boolean,
      'step_c_not_applied', (v_stale_check->>'applied')::boolean = false,
      'step_c_stored_quote_total', v_stale_check->>'stored_quote_total',
      'step_c_current_quote_total', v_stale_check->>'current_quote_total',
      'step_d_applied_with_force', (v_force_res->>'applied')::boolean,
      'step_d_stale_false_after_force', (v_force_res->>'stale')::boolean = false,
      'final_quote_total', (v_after_isa->>'quote_total_cents')::int,
      'final_consistency_check',
        (SELECT COALESCE(SUM(subtotal_cents),0) FROM public.invoices WHERE client_id=v_isabella_client) = (SELECT total_cents FROM public.quotes WHERE id=v_isabella_quote),
      'pending_final_status', (SELECT status FROM public.pending_changes WHERE id=v_pending_id_stale),
      'expect', 'step_c stale=true, not applied; step_d applies fresh from current state; consistency ✓'
    )
  );

  -- ===== BONUS: notifications =====
  INSERT INTO public._b4_test_results (scenario, result) VALUES (
    'BONUS — Notifications fired',
    jsonb_build_object(
      'owner_proposal_notifs', (SELECT COUNT(*) FROM public.notifications WHERE user_id=v_owner AND kind='pricing_change.proposed' AND created_at > now() - interval '5 minutes'),
      'manager_approval_notifs', (SELECT COUNT(*) FROM public.notifications WHERE user_id=v_manager AND kind='pricing_change.approved' AND created_at > now() - interval '5 minutes'),
      'manager_rejection_notifs', (SELECT COUNT(*) FROM public.notifications WHERE user_id=v_manager AND kind='pricing_change.rejected' AND created_at > now() - interval '5 minutes')
    )
  );
END $$;
