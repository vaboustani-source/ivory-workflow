
-- 1) Wipe stale test quotes (anything not marked as backfilled)
DELETE FROM public.quote_item_cost_snapshots
  WHERE quote_item_id IN (
    SELECT qi.id FROM public.quote_items qi
    JOIN public.quotes q ON q.id = qi.quote_id
    WHERE q.notes IS NULL OR q.notes NOT LIKE 'Backfilled from existing package/investment%'
  );
DELETE FROM public.quote_items
  WHERE quote_id IN (
    SELECT id FROM public.quotes
    WHERE notes IS NULL OR notes NOT LIKE 'Backfilled from existing package/investment%'
  );
DELETE FROM public.quotes
  WHERE notes IS NULL OR notes NOT LIKE 'Backfilled from existing package/investment%';

-- 2) Backfill: one quote per eligible client that doesn't already have one
WITH eligible AS (
  SELECT c.id AS client_id,
         c.booked_at,
         ROUND(COALESCE(c.package_price, p.base_price, 0) * 100)::int AS cents,
         COALESCE(p.name, 'Booked package') AS pkg_name
  FROM public.clients c
  LEFT JOIN public.packages p ON p.id = c.package_id
  WHERE (c.package_id IS NOT NULL OR c.package_price IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.client_id = c.id)
),
new_quotes AS (
  INSERT INTO public.quotes (client_id, status, accepted_at, subtotal_cents, discount_cents, total_cents, notes)
  SELECT client_id, 'accepted'::quote_status, COALESCE(booked_at, now()),
         cents, 0, cents,
         'Backfilled from existing package/investment on ' || to_char(now(), 'YYYY-MM-DD')
  FROM eligible
  RETURNING id, client_id, total_cents
),
new_items AS (
  INSERT INTO public.quote_items
    (quote_id, service_item_id, description_snapshot, unit_price_cents, quantity, line_total_cents, item_type_snapshot, display_order)
  SELECT nq.id, NULL, e.pkg_name, e.cents, 1, e.cents, 'wedding_package'::service_item_type, 0
  FROM new_quotes nq
  JOIN eligible e ON e.client_id = nq.client_id
  RETURNING id
)
INSERT INTO public.quote_item_cost_snapshots (quote_item_id, cost_cents_snapshot)
SELECT id, 0 FROM new_items;
