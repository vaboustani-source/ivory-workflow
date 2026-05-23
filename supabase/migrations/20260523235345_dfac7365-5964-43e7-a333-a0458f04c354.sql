
-- Reverse Isabella's test add ($1,200 across 3 unpaid, no fees)
UPDATE public.invoices SET subtotal_cents=525000, total_cents=525000, processing_fee_cents=0, amount=5250
  WHERE id IN ('a7237738-50ed-484b-b76d-617969e80148','17014fac-4dc4-4a03-96e6-e1ad49e536d0');
UPDATE public.invoices SET subtotal_cents=700000, total_cents=700000, processing_fee_cents=0, amount=7000
  WHERE id='5e436179-90f7-4f86-81ae-9fe561cd36ba';

-- Reverse Sophia's test add ($1,200 across 3 unpaid, fees baked)
UPDATE public.invoices SET subtotal_cents=360000, total_cents=370783, processing_fee_cents=10783, amount=3707.83
  WHERE id IN ('910d10de-75ab-4d3f-87bb-14ac1aba1ab0','8d54b829-6809-49e8-b05c-186e3f4125de');
UPDATE public.invoices SET subtotal_cents=480000, total_cents=494367, processing_fee_cents=14367, amount=4943.67
  WHERE id='99a3c06c-1ce8-42e6-b87f-3f7843c56d93';

-- Remove the test invoice_line_items rows
DELETE FROM public.invoice_line_items
WHERE description LIKE 'Post-booking addition: B3 test add%';

-- Remove the test quote_items (and cascade snapshots/inclusions)
DELETE FROM public.quote_item_inclusions WHERE quote_item_id IN
  ('51a91146-45ec-4096-b14e-9c83929cb659','b5dca0dd-fd7d-4663-af57-c647162d8e71');
DELETE FROM public.quote_item_cost_snapshots WHERE quote_item_id IN
  ('51a91146-45ec-4096-b14e-9c83929cb659','b5dca0dd-fd7d-4663-af57-c647162d8e71');
DELETE FROM public.quote_items WHERE id IN
  ('51a91146-45ec-4096-b14e-9c83929cb659','b5dca0dd-fd7d-4663-af57-c647162d8e71');

-- Restore quote totals
UPDATE public.quotes SET subtotal_cents=1750000, total_cents=1750000 WHERE id='382056d1-2f62-4df3-aa17-255a51105428';
UPDATE public.quotes SET subtotal_cents=1200000, total_cents=1200000 WHERE id='af5a4623-c1cb-467d-b6de-7509e3a2ee6f';

-- Remove the test activity log entries
DELETE FROM public.activity_log
WHERE action_type='quote.item_added_post_booking'
  AND target_id IN ('51a91146-45ec-4096-b14e-9c83929cb659','b5dca0dd-fd7d-4663-af57-c647162d8e71');

-- Drop helpers
DROP TABLE IF EXISTS public._b3_test_results;
DROP FUNCTION IF EXISTS public._b3_test_add(uuid,text,int,uuid);
