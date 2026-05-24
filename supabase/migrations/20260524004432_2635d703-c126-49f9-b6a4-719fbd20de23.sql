
-- ===== Revert quote_items, invoice_line_items added by tests =====
-- Delete invoice line items inserted during tests (recognizable by description prefix)
DELETE FROM public.invoice_line_items
WHERE description LIKE 'Post-booking addition: B4 #%'
   OR description LIKE 'Post-booking addition: B4 Test #%';

-- Delete quote_item cost snapshots + inclusions for test quote items
DELETE FROM public.quote_item_cost_snapshots
WHERE quote_item_id IN (
  SELECT id FROM public.quote_items
  WHERE description_snapshot LIKE 'B4 #%' OR description_snapshot LIKE 'B4 Test #%'
);
DELETE FROM public.quote_item_inclusions
WHERE quote_item_id IN (
  SELECT id FROM public.quote_items
  WHERE description_snapshot LIKE 'B4 #%' OR description_snapshot LIKE 'B4 Test #%'
);
DELETE FROM public.quote_items
WHERE description_snapshot LIKE 'B4 #%' OR description_snapshot LIKE 'B4 Test #%';

-- Restore Isabella's quote + invoices ($1,750k, 3 installments at $525k/$525k/$700k)
UPDATE public.quotes
SET subtotal_cents = 1750000, total_cents = 1750000, updated_at = now()
WHERE id = '382056d1-2f62-4df3-aa17-255a51105428';
UPDATE public.invoices
SET subtotal_cents = 525000, total_cents = 525000, processing_fee_cents = 0,
    amount = 5250, updated_at = now()
WHERE id IN ('a7237738-50ed-484b-b76d-617969e80148','17014fac-4dc4-4a03-96e6-e1ad49e536d0');
UPDATE public.invoices
SET subtotal_cents = 700000, total_cents = 700000, processing_fee_cents = 0,
    amount = 7000, updated_at = now()
WHERE id = '5e436179-90f7-4f86-81ae-9fe561cd36ba';

-- Restore Sophia's quote (no items applied via test 3 since rejected; only delete proposed pending)
UPDATE public.quotes
SET subtotal_cents = 1200000, total_cents = 1200000, updated_at = now()
WHERE id = 'af5a4623-c1cb-467d-b6de-7509e3a2ee6f';

-- Restore Charlotte's quote + invoices to pre-test ($1,800k baseline; pre-test installments)
-- Charlotte fees-baked: Retainer 540000/556174, Final 540000/556174, Mid-payment 720000/741551
UPDATE public.quotes
SET subtotal_cents = 1800000, total_cents = 1800000, updated_at = now()
WHERE id = 'b9d79800-fdce-4d6a-99c2-86032866725c';
UPDATE public.invoices
SET subtotal_cents = 540000, processing_fee_cents = 16174, total_cents = 556174,
    amount = 5561.74, updated_at = now()
WHERE id IN ('dc8966da-3633-4028-aaef-11b28e16a73f','cc258e8d-34b9-4f77-8994-9576886528b0');
UPDATE public.invoices
SET subtotal_cents = 720000, processing_fee_cents = 21551, total_cents = 741551,
    amount = 7415.51, updated_at = now()
WHERE id = '143fdeb9-3c6d-4736-b30c-3cd557653fc3';

-- Clear test-generated pending_changes, notifications, activity_log entries
DELETE FROM public.pending_changes WHERE payload->>'resolved_description' LIKE 'B4 #%' OR payload->>'resolved_description' LIKE 'B4 Test #%';
DELETE FROM public.notifications WHERE created_at > now() - interval '1 hour' AND kind LIKE 'pricing_change.%';
DELETE FROM public.activity_log WHERE action_type IN ('pricing_change.proposed','pricing_change.approved','pricing_change.rejected','quote.item_added_post_booking') AND created_at > now() - interval '1 hour';

-- Drop test harness
DROP FUNCTION IF EXISTS public._b4_test_add_as(uuid, uuid, uuid, numeric, text, int);
DROP FUNCTION IF EXISTS public._b4_test_approve_as(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public._b4_test_reject_as(uuid, uuid, text);
DROP TABLE IF EXISTS public._b4_test_results;
